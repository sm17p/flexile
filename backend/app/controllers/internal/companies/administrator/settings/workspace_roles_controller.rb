# frozen_string_literal: true

require "set"

class Internal::Companies::Administrator::Settings::WorkspaceRolesController < ApplicationController
  before_action :load_target_company!
  before_action :validate_available_users_params!, only: [:index]

  def index
    policy = CompanyWorkspaceRoleManagementPolicy.new(current_context, @target_company)
    unless policy.invite_workspace_members?("admin")
      render json: { error: "Unauthorized" }, status: :forbidden
      return
    end

    presenter = CompanyUsersPresenter.new(company: @target_company)

    if params[:available_only] == 'true'
      result = presenter.users_without_role_props(
        exclude_roled_user_ids: @exclude_roled_user_ids,
        current_user: Current.user
      )
      render json: result
    else
      render json: {
        administrators: presenter.administrators_props,
        lawyers: presenter.lawyers_props,
      }
    end
  end

  private
    def load_target_company!
      @target_company = Current.company
    end

    def validate_available_users_params!
      @exclude_roled_user_ids = params[:excludeRoledUserIds] || []
    end
end
