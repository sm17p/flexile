# frozen_string_literal: true

class CompanyWorkspaceMemberManagementPolicy < ApplicationPolicy
  MANAGEABLE_ROLES = %w[admin lawyer].freeze

  def invite_workspace_members?
    company_administrator?
  end

  def can_manage_role?(role)
    company_administrator? && MANAGEABLE_ROLES.include?(role.to_s.downcase)
  end

  def can_manage_all_roles?(roles)
    return false if roles.blank?

    company_administrator? && roles.all? { |role| MANAGEABLE_ROLES.include?(role.to_s.downcase) }
  end
end
