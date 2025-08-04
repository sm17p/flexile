# frozen_string_literal: true

class BatchSendInvitationEmailsJob
  include Sidekiq::Worker
  sidekiq_options retry: 5, queue: :default

  def perform(invitations)
    invitations.each do |invitation_data|
      case invitation_data["type"]
      when "new_user_invitation"
        create_and_invite_new_user(invitation_data)
      when "existing_user_invitation"
        send_invitation_email(invitation_data)
      end
    end
  rescue => e
    Rails.logger.error "BatchSendInvitationEmailsJob error: #{e.message}\n#{e.backtrace.join("\n")}"
    raise
  end

  private
    def create_and_invite_new_user(invitation_data)
      email = invitation_data["email"]
      role = invitation_data["role"]
      company_id = invitation_data["company_id"]
      current_user_id = invitation_data["current_user_id"]

      company = Company.find(company_id)
      current_user = User.find(current_user_id)

      user = User.new(email: email)
      user.invite!(current_user) { |u| u.skip_invitation = true }

      if user.errors.any?
        Rails.logger.warn "Failed to create user #{email}: #{user.errors.full_messages.join(', ')}"
        return
      end

      company_member = case role
                       when "admin"
                         user.company_administrators.build(company: company)
                       when "lawyer"
                         user.company_lawyers.build(company: company)
      end

      if company_member.save
        send_invitation_email_for_new_user(company_member, user, role)
      else
        Rails.logger.warn "Failed to create company relationship for #{email}: #{company_member.errors.full_messages.join(', ')}"
      end
    rescue => e
      Rails.logger.warn "Failed to create and invite user #{email}: #{e.message}"
    end

    def send_invitation_email(invitation_data)
      company_member_id = invitation_data["company_member_id"]
      invitation_data["company_member_type"]
      user_id = invitation_data["user_id"]
      role = invitation_data["role"]

      user = User.find(user_id)
      Rails.logger.info "User exists: #{user.inspect}"
      clerk_invitation_url = user.create_clerk_invitation

      case role
      when "admin"
        CompanyAdministratorMailer.invitation_instructions(
          admin_id: company_member_id,
          url: clerk_invitation_url
        ).deliver_now
      when "lawyer"
        CompanyLawyerMailer.invitation_instructions(
          lawyer_id: company_member_id,
          url: clerk_invitation_url
        ).deliver_now
      end
    rescue => e
      Rails.logger.warn "Failed to send invitation email for #{role} #{invitation_data['email']}: #{e.message}"
    end

    def send_invitation_email_for_new_user(company_member, user, role)
      clerk_invitation_url = user.create_clerk_invitation

      case role
      when "admin"
        CompanyAdministratorMailer.invitation_instructions(
          admin_id: company_member.id,
          url: clerk_invitation_url
        ).deliver_now
      when "lawyer"
        CompanyLawyerMailer.invitation_instructions(
          lawyer_id: company_member.id,
          url: clerk_invitation_url
        ).deliver_later(queue: :mailers)
      end
    rescue => e
      Rails.logger.warn "Failed to send invitation email for new #{role} #{user.email}: #{e.message}"
    end
end