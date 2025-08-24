# frozen_string_literal: true

require "set"

class CompanyUsersPresenter
  def initialize(company:)
    @company = company
  end

  def props
    {
      administrators: administrators_props,
      lawyers: lawyers_props,
      all_users: all_users_props,
    }
  end

  def administrators_props
    admins = @company.company_administrators
                    .joins(:user)
                    .order(:id, Arel.sql("COALESCE(users.legal_name, users.preferred_name, users.email)"))
                    .includes(:user)

    primary_admin = admins.first

    admins.map do |admin|
      user = admin.user
      roles = get_user_roles(user)

      {
        id: user.external_id,
        email: user.email,
        name: user.legal_name || user.preferred_name || user.email,
        isAdmin: true,
        role: primary_admin&.id == admin.id ? "Owner" : "Admin",
        isOwner: primary_admin&.id == admin.id,
        allRoles: roles,
      }
    end
  end

  def lawyers_props
    @company.company_lawyers
            .joins(:user)
            .order(Arel.sql("COALESCE(users.legal_name, users.preferred_name, users.email)"))
            .includes(:user)
            .map do |lawyer|
      user = lawyer.user
      roles = get_user_roles(user)

      {
        id: user.external_id,
        email: user.email,
        name: user.legal_name || user.preferred_name || user.email,
        isAdmin: roles.include?("Admin"),
        role: "Lawyer",
        isOwner: is_primary_admin?(user),
        allRoles: roles,
      }
    end
  end

  def all_users_props
    seen = Set.new
    all_users = []

    [administrators_props, lawyers_props].each do |role_users|
      role_users.each do |user|
        next if seen.include?(user[:id])
        seen.add(user[:id])
        all_users << {
          id: user[:id],
          email: user[:email],
          name: user[:name],
          allRoles: user[:allRoles],
        }
      end
    end

    all_users.sort_by { |user| user[:name] }
  end

  def users_without_role_props(exclude_roled_user_ids: [], current_user: nil)
    company_user_ids = Set.new
    @company.company_investors.includes(:user).find_each { |ci| company_user_ids.add(ci.user_id) }
    @company.company_workers.includes(:user).find_each { |cw| company_user_ids.add(cw.user_id) }

    # Return empty array if no company-related users exist
    return [] if company_user_ids.empty?

    # Get users who already have workspace roles
    excluded_user_external_ids = Set.new(all_users_props.map { |user| user[:id] })

    # Add explicitly excluded user IDs from params
    exclude_roled_user_ids.each { |id| excluded_user_external_ids.add(id) }

    # Add current user to exclusions
    excluded_user_external_ids.add(current_user.external_id) if current_user

    # Filter and sort users at database level
    eligible_users = User.where(id: company_user_ids)
                        .where.not(external_id: excluded_user_external_ids.to_a)
                        .where(invitation_token: nil) # Exclude pending invitations
                        .order(Arel.sql("COALESCE(legal_name, preferred_name, email)"))
                        .includes(:company_investors, :company_workers)

    # Transform results (already sorted by database)
    eligible_users.map do |user|
      {
        id: user.external_id,
        email: user.email,
        name: user.legal_name || user.preferred_name || user.email,
        isInvestor: user.company_investors.any? { |ci| ci.company_id == @company.id },
        isContractor: user.company_workers.any? { |cw| cw.company_id == @company.id },
        isAdministrator: false,
        isLawyer: false,
      }
    end
  end

  private
    def get_user_roles(user)
      roles = []

      roles << "Admin" if @company.company_administrators.exists?(user: user)
      roles << "Lawyer" if @company.company_lawyers.exists?(user: user)

      roles
    end

    def is_primary_admin?(user)
      primary_admin = @company.primary_admin
      primary_admin&.user_id == user.id
    end
end
