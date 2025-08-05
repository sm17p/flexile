# frozen_string_literal: true

class InviteAdministrator
  def initialize(company:, email:, current_user:)
    @company = company
    @email = email
    @current_user = current_user
  end

  def perform
    user = User.find_or_initialize_by(email: email)
    return { success: false, field: "email", error_message: "Email has already been taken" } if user.persisted?

    company_administrator = user.company_administrators.find_or_create_by(company: company)
    user.invite!(current_user) { |u| u.skip_invitation = true }

    if user.errors.blank?
      InviteAdministrator.send_email(admin_id: company_administrator.id, url: user.create_clerk_invitation)
      { success: true }
    else
      error_object = if company_administrator.errors.any?
        company_administrator
      else
        user
      end
      { success: false, field: error_object.errors.first.attribute, error_message: error_object.errors.first.full_message }
    end
  end

  def self.send_email(admin_id:, url:)
    CompanyAdministratorMailer.invitation_instructions(
      admin_id: admin_id,
      url: url
    ).deliver_later
  end

  private
    attr_reader :company, :email, :current_user
end
