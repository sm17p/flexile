# frozen_string_literal: true

class CompanyWorkspaceRoleManagementPolicy < ApplicationPolicy
  def invite_workspace_members?(role)
    company_administrator?
  end
end
