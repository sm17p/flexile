# frozen_string_literal: true

class Internal::Companies::Administrator::Settings::WorkspaceMembersController < ApplicationController
  before_action :load_target_company!

  def create
    authorize @target_company, :invite_workspace_members?, policy_class: CompanyWorkspaceMemberManagementPolicy
    return unless validate_requested_roles! if params[:members].present?

    result = BatchManageWorkspaceMembers.new(
      company: @target_company,
      members: params[:members] || [],
      current_user: Current.user
    ).perform

    if result[:success]
      render json: {
        success: true,
        invited_count: result[:invited_count],
        updated_count: result[:updated_count],
        total_processed: result[:total_processed],
      }, status: :created
    else
      render json: {
        success: false,
        errors: result[:errors],
        invited_count: result[:invited_count],
        updated_count: result[:updated_count],
      }, status: :unprocessable_entity
    end
  end

  private
    def load_target_company!
      @target_company = Current.company
    end

    def validate_requested_roles!
      policy = CompanyWorkspaceMemberManagementPolicy.new(current_context, @target_company)
      requested_roles = extract_requested_roles

      unless policy.can_manage_all_roles?(requested_roles)
        invalid_roles = requested_roles.reject { |role| policy.can_manage_role?(role) }
        render json: {
          success: false,
          error: "Cannot manage roles: #{invalid_roles.join(', ')}",
        }, status: :forbidden
        return false
      end
      true
    end

    def extract_requested_roles
      params[:members].filter_map { |m| m[:role] }.uniq
    end
end
