# frozen_string_literal: true

require "nanoid"

# BatchManageWorkspaceMembers Pseudo Code:
# 1. Validate input data (emails, roles)
# 2. Deduplicate emails and map to roles (last role wins for duplicates)
# 3. Single query to get all existing users and their relationships
# 4. Plan bulk operations: removals and additions based on role changes
# 5. Execute bulk operations: remove old roles, add new roles, invite new users
# 6. Return success/failure with counts

class BatchManageWorkspaceMembers
  BATCH_SIZE = 100
  BULK_INSERT_THRESHOLD = 10
  EMAIL_REGEX = URI::MailTo::EMAIL_REGEXP

  attr_accessor :invited_count, :updated_count, :errors

  attr_reader :company, :workspace_members, :current_user

  def self.perform(company:, members:, current_user:)
    new(company: company, members: members, current_user: current_user).perform
  end

  def initialize(company:, members:, current_user:)
    @company = company
    @workspace_members = members
    @current_user = current_user
    @errors = []
    @invited_count = 0
    @updated_count = 0
    @pending_invitations = []
  end

  def perform
    return failure_response("No workspace members provided") if workspace_members.blank?

    validation_errors = validate_workspace_members
    return failure_response(validation_errors) if validation_errors.any?

    ActiveRecord::Base.transaction do
      process_workspace_members_optimized
    end

    # Queue batch email job after transaction commits
    BatchSendInvitationEmailsJob.perform_later(@pending_invitations) if @pending_invitations.any?

    errors.any? ? failure_response(errors) : success_response
  rescue => e
    Rails.logger.error "BatchManageWorkspaceMembers error: #{e.message}\n#{e.backtrace.join("\n")}"
    failure_response([{ field: "base", error_message: "An unexpected error occurred. Please try again." }])
  end

  private
    UserRelationshipData = Struct.new(
      :users_by_email,
      :existing_admins,
      :existing_lawyers,
      keyword_init: true
    )

    BulkOperationPlans = Struct.new(
      :users_to_remove_admin,
      :users_to_remove_lawyer,
      :new_admins_to_create,
      :new_lawyers_to_create,
      :users_to_invite,
      keyword_init: true
    ) do
      def initialize(**args)
        super
        self.users_to_remove_admin ||= []
        self.users_to_remove_lawyer ||= []
        self.new_admins_to_create ||= []
        self.new_lawyers_to_create ||= []
        self.users_to_invite ||= []
      end
    end

    def validate_workspace_members
      validation_errors = []

      workspace_members.each_with_index do |workspace_member, index|
        email = normalize(workspace_member[:email])
        role = normalize(workspace_member[:role])

        validation_errors.concat(validate_member_data(email, role, index))
      end

      validation_errors
    end

    def normalize(value)
      value.to_s.strip.downcase
    end

    def validate_member_data(email, role, index)
      errors = []

      if email.blank?
        errors << { index: index, field: "email", error_message: "Email is required" }
      elsif !valid_email?(email)
        errors << { index: index, field: "email", error_message: "Email format is invalid" }
      end

      if role.blank?
        errors << { index: index, field: "role", error_message: "Role is required" }
      elsif !valid_role?(role)
        errors << { index: index, field: "role", error_message: "Invalid role: #{role}" }
      end

      errors
    end

    def valid_email?(email)
      return false if email.blank?
      email.match?(EMAIL_REGEX)
    end

    def valid_role?(role)
      CompanyWorkspaceMemberManagementPolicy::MANAGEABLE_ROLES.include?(role)
    end

    def process_workspace_members_optimized
      # Can't invite yourself, also protects last admin from processing
      mailing_list_with_role_mapped = build_mailing_list_with_role_mapped(current_user.email)
      relationship_data = fetch_existing_relationships(mailing_list_with_role_mapped.keys)
      operation_plans = plan_bulk_operations(mailing_list_with_role_mapped, relationship_data)
      execute_bulk_operations(operation_plans)
    end

    def build_mailing_list_with_role_mapped(exclude_email)
      mailing_list_with_role_mapped = {}
      normalized_exclude_email = normalize(exclude_email)

      workspace_members.each do |workspace_member|
        email = normalize(workspace_member[:email])
        role = normalize(workspace_member[:role])

        next if email.blank? || role.blank? || email == normalized_exclude_email

        mailing_list_with_role_mapped[email] = role
      end

      mailing_list_with_role_mapped
    end

    def fetch_existing_relationships(unique_emails)
      users_with_relationships = User.includes(:company_administrators, :company_lawyers)
                                    .where(email: unique_emails)

      users_by_email = {}
      existing_admins = {}
      existing_lawyers = {}

      users_with_relationships.each do |user|
        email_key = user.email.downcase
        users_by_email[email_key] = user

        admin = user.company_administrators.find { |ca| ca.company_id == company.id }
        existing_admins[email_key] = admin if admin

        lawyer = user.company_lawyers.find { |cl| cl.company_id == company.id }
        existing_lawyers[email_key] = lawyer if lawyer
      end

      UserRelationshipData.new(
        users_by_email: users_by_email,
        existing_admins: existing_admins,
        existing_lawyers: existing_lawyers
      )
    end

    def plan_bulk_operations(mailing_list_with_role_mapped, relationship_data)
      operation_plans = BulkOperationPlans.new

      mailing_list_with_role_mapped.each do |email, role|
        user = relationship_data.users_by_email[email]

        if user
          defer_role_updates_for_existing_user(
            user: user,
            email: email,
            new_role: role,
            relationship_data: relationship_data,
            operation_plans: operation_plans
          )
        else
          operation_plans.users_to_invite << { email: email, role: role }
        end
      end

      operation_plans
    end

    def defer_role_updates_for_existing_user(user:, email:, new_role:, relationship_data:, operation_plans:)
      current_admin = relationship_data.existing_admins[email]
      current_lawyer = relationship_data.existing_lawyers[email]

      has_admin = current_admin.present?
      has_lawyer = current_lawyer.present?

      # Skip if user already has the correct role and no conflicting roles
      return if role_already_correct?(new_role, has_admin, has_lawyer)

      # Remove existing roles
      operation_plans.users_to_remove_admin << user.id if has_admin
      operation_plans.users_to_remove_lawyer << user.id if has_lawyer

      # Add new role
      add_user_to_new_role(user, new_role, operation_plans)
    end

    def role_already_correct?(new_role, has_admin, has_lawyer)
      (new_role == "admin" && has_admin && !has_lawyer) ||
      (new_role == "lawyer" && has_lawyer && !has_admin)
    end

    def add_user_to_new_role(user, new_role, operation_plans)
      case new_role
      when "admin"
        operation_plans.new_admins_to_create << user
      when "lawyer"
        operation_plans.new_lawyers_to_create << user
      end
    end

    def execute_bulk_operations(operation_plans)
      remove_existing_relationships(operation_plans)

      create_bulk_relationships(operation_plans.new_admins_to_create, "admin", invited: false)
      create_bulk_relationships(operation_plans.new_lawyers_to_create, "lawyer", invited: false)

      operation_plans.users_to_invite.each do |user_data|
        queue_user_invitation(user_data[:email], user_data[:role])
      end
    end

    def remove_existing_relationships(operation_plans)
      if operation_plans.users_to_remove_admin.any?
        company.company_administrators.where(user_id: operation_plans.users_to_remove_admin).delete_all
      end

      if operation_plans.users_to_remove_lawyer.any?
        company.company_lawyers.where(user_id: operation_plans.users_to_remove_lawyer).delete_all
      end
    end

    def create_bulk_relationships(users, role, invited:)
      return if users.empty?

      if users.size < BULK_INSERT_THRESHOLD
        create_individual_relationships(users, role, invited)
        return
      end

      create_relationships_in_batches(users, role, invited)
    end

    def create_individual_relationships(users, role, invited)
      users.each { |user| create_individual_relationship(user, role, invited: invited) }
    end

    def create_relationships_in_batches(users, role, invited)
      batch_size = [users.size, BATCH_SIZE].min

      users.each_slice(batch_size) do |user_batch|
        relationships = build_relationship_batch(user_batch)

        if bulk_insert_relationships(relationships, role)
          self.updated_count += relationships.size unless invited
        else
          fallback_to_individual_inserts(user_batch, role, invited)
        end
      end
    end

    def build_relationship_batch(user_batch)
      nanoid_alphabet = [*(0..9).to_a, *("a".."z").to_a].join
      nanoid_length = 13
      user_batch.map do |user|
        {
          user_id: user.id,
          company_id: company.id,
          external_id: Nanoid.generate(size: nanoid_length, alphabet: nanoid_alphabet),
          created_at: Time.current,
          updated_at: Time.current,
        }
      end
    end

    def bulk_insert_relationships(relationships, role)
      case role
      when "admin"
        CompanyAdministrator.insert_all(relationships, returning: false)
      when "lawyer"
        CompanyLawyer.insert_all(relationships, returning: false)
      end
      true
    rescue => e
      Rails.logger.warn "Bulk insert failed for #{role}s, falling back to individual inserts: #{e.message}"
      false
    end

    def fallback_to_individual_inserts(user_batch, role, invited)
      user_batch.each do |user|
        create_individual_relationship(user, role, invited: invited)
      end
    end

    def create_individual_relationship(user, role, invited:)
      company_member = build_company_relationship(user, role)

      if company_member.save
        handle_successful_relationship_creation(company_member, user, role, invited)
      else
        handle_failed_relationship_creation(company_member, user)
      end
    end

    def handle_successful_relationship_creation(company_member, user, role, invited)
      if invited
        queue_invitation_email(company_member, user, role)
        self.invited_count += 1
      else
        self.updated_count += 1
      end
    end

    def handle_failed_relationship_creation(company_member, user)
      errors << {
        email: user.email,
        field: company_member.errors.first&.attribute || "base",
        error_message: company_member.errors.first&.full_message || "Failed to save relationship",
      }
    end

    def build_company_relationship(user, role)
      case role
      when "admin" then user.company_administrators.build(company: company)
      when "lawyer" then user.company_lawyers.build(company: company)
      end
    end

    def queue_user_invitation(email, role)
      @pending_invitations << {
        "email" => email,
        "role" => role,
        "company_id" => company.id,
        "current_user_id" => current_user.id,
        "type" => "new_user_invitation",
      }
      self.invited_count += 1
    end

    def queue_invitation_email(company_member, user, role)
      @pending_invitations << {
        "company_member_id" => company_member.id,
        "company_member_type" => company_member.class.name,
        "user_id" => user.id,
        "role" => role,
        "email" => user.email,
        "type" => "existing_user_invitation",
      }
    end

    def success_response
      {
        success: true,
        invited_count: invited_count,
        updated_count: updated_count,
        total_processed: invited_count + updated_count,
      }
    end

    def failure_response(error_data)
      formatted_errors = case error_data
                         when String
                           [{ field: "workspace_members", error_message: error_data }]
                         when Array
                           error_data
                         else
                           [{ field: "base", error_message: "Unknown error" }]
      end

      {
        success: false,
        errors: formatted_errors,
        invited_count: invited_count,
        updated_count: updated_count,
      }
    end
end
