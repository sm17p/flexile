# frozen_string_literal: true

class InviteAdministrator
  def initialize(company:, email:, current_user:)
    @company = company
    @email = email
    @current_user = current_user
  end

  def perform
    user = User.find_or_initialize_by(email: email.to_s.downcase)

    if user.company_administrators.exists?(company_id: company.id)
      return {
        success: false,
        field: :email,
        error_message: "User already has an administrator account for this company",
      }
    end

    company_administrator = nil

    ActiveRecord::Base.transaction do
      user.save! if user.new_record?

      company_administrator = user.company_administrators.create!(company: company)

      user.invite!(current_user) { |u| u.skip_invitation = true }
    end

    InviteAdministrator.send_email(admin_id: company_administrator.id, url: user.create_clerk_invitation)

    { success: true }

  rescue ActiveRecord::RecordInvalid => e
    error_object = e.record
    {
      success: false,
      field: error_object.errors.first.attribute,
      error_message: error_object.errors.full_messages.first,
    }
  rescue StandardError => e
    { success: false, field: :base, error_message: e.message }
  end

  def self.send_email(admin_id:, url:)
    CompanyAdministratorMailer.invitation_instructions(
      admin_id: admin_id,
      url: url
    ).deliver_later(queue: "mailers", wait: 3.seconds)
  end

  private
    attr_reader :company, :email, :current_user
end
