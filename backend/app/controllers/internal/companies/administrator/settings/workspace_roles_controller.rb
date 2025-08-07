# frozen_string_literal: true

class Internal::Companies::Administrator::Settings::WorkspaceRolesController < ApplicationController
  before_action :load_target_company!
  before_action :validate_and_authorize_input!, only: [:create]

  def create
    result = case @role
             when "admin"
               InviteAdministrator.new(
                 company: @target_company,
                 email: @email,
                 current_user: Current.user
               ).perform
             when "lawyer"
               InviteLawyer.new(
                 company: @target_company,
                 email: @email,
                 current_user: Current.user
               ).perform
    end

    if result[:success]
      render json: {
        success: true,
        message: "Member invited successfully",
      }, status: :created
    else
      render json: {
        success: false,
        field: result[:field],
        error: result[:error_message],
      }, status: :unprocessable_entity
    end
  end

  private
    def load_target_company!
      @target_company = Current.company
    end

    def validate_and_authorize_input!
      authorize @target_company, :invite_workspace_members?, policy_class: CompanyWorkspaceRoleManagementPolicy

      @email = params[:email]&.strip&.downcase
      @role = params[:role]&.strip&.downcase

      # Input Validation
      validation_error = validate_member_input(@email, @role)
      if validation_error
        render json: {
          success: false,
          field: validation_error[:field],
          error: validation_error[:error],
        }, status: :unprocessable_entity
        return
      end

      policy = CompanyWorkspaceRoleManagementPolicy.new(current_context, @target_company)
      unless policy.can_manage_role?(@role)
        render json: {
          success: false,
          field: :role,
          error: "Cannot manage role: #{@role}",
        }, status: :forbidden
        return
      end
    end

    def validate_member_input(email, role)
      return { field: :email, error: "Email is required" } if email.blank?
      return { field: :email, error: "Email format is invalid" } unless email.match?(URI::MailTo::EMAIL_REGEXP)
      return { field: :role, error: "Role is required" } if role.blank?
      return { field: :role, error: "Invalid role: #{role}" } unless CompanyWorkspaceRoleManagementPolicy::MANAGEABLE_ROLES.include?(role)
      return { field: :email, error: "Cannot invite yourself" } if email.downcase == Current.user.email.downcase

      nil
    end
end
