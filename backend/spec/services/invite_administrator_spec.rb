# frozen_string_literal: true

include ActiveJob::TestHelper
if Rails::VERSION::MAJOR >= 7
  include ActiveSupport::Testing::TaggedLogging
end

RSpec.describe InviteAdministrator do
  let!(:company) { create(:company, :completed_onboarding) }
  let(:email) { "admin@example.com" }
  let!(:current_user) { create(:user) }
  let(:invitation_url) { "http://test-invitation-url" }

  subject(:invite_administrator) { described_class.new(company:, email:, current_user:).perform }

  describe "#perform" do
    context "when inviting a new user actually sends invitation email with correct content" do
      it "actually sends invitation email with correct content", :vcr do
        allow_any_instance_of(User).to receive(:create_clerk_invitation).and_return(invitation_url)

        result = nil
        expect do
          perform_enqueued_jobs do
            result = invite_administrator
          end
        end.to change(User, :count).by(1)
          .and change(CompanyAdministrator, :count).by(1)
          .and change { ActionMailer::Base.deliveries.count }.by(1)


        expect(result[:success]).to be true

        # Verify database records
        user = User.last
        company_administrator = CompanyAdministrator.last
        expect(user.email).to eq(email)
        expect(company_administrator.company).to eq(company)
        expect(company_administrator.user).to eq(user)
        expect(user.invited_by).to eq(current_user)

        # Verify email was actually sent
        sent_email = ActionMailer::Base.deliveries.last

        expect(sent_email).to be_multipart
        expect(sent_email.parts.length).to eq(2) # text and html parts
        expect(sent_email.from).to eq([Rails.application.config.action_mailer.default_options[:from]])
        expect(sent_email.reply_to).to eq([company.email])
        expect(sent_email.subject).to eq("You've been invited to join #{company.name} as an administrator")
        expect(sent_email.to).to eq([email])

        html_part = sent_email.html_part
        text_part = sent_email.text_part

        expect(html_part).not_to be_nil
        expect(html_part.content_type).to include("text/html")
        expect(html_part.body.decoded).to include(company.name)
        expect(html_part.body.decoded).to include(invitation_url)

        expect(text_part).not_to be_nil
        expect(text_part.content_type).to include("text/plain")
        expect(text_part.body.decoded).to include(company.name)
        expect(text_part.body.decoded).to include(invitation_url)
      end
    end

    context "when inviting an existing admin" do
      let(:company_administrator) { create(:company_administrator, company:, user: create(:user, email:)) }

      before { company_administrator }

      it "returns an error and does not create new records or send emails" do
        result = nil
        expect do
          perform_enqueued_jobs do
            result = invite_administrator
          end
        end.not_to have_enqueued_mail(CompanyAdministratorMailer, :invitation_instructions)

        expect { result }.not_to change(User, :count)
        expect { result }.not_to change(CompanyAdministrator, :count)
        expect { result }.not_to change { ActionMailer::Base.deliveries.count }

        expect(result[:success]).to be false
        expect(result[:error_message]).to eq("User already has an administrator account for this company")
        expect(result[:field]).to eq(:email)
      end
    end

    context "email case handling" do
      let(:email) { "ADmIN@example.com" }

      it "normalizes email case when creating user and sending email", :vcr do
        allow_any_instance_of(User).to receive(:create_clerk_invitation).and_return(invitation_url)

        result = nil
        expect do
          perform_enqueued_jobs do
            result = invite_administrator
          end
        end.to change { ActionMailer::Base.deliveries.count }.by(1)

        expect(result[:success]).to be true

        user = User.last
        expect(user.email).to eq("admin@example.com")

        sent_email = ActionMailer::Base.deliveries.last
        expect(sent_email.to).to eq(["admin@example.com"])
      end
    end

    context "error handling" do
      context "when user invitation fails" do
        it "returns appropriate error message and does not send email" do
          failing_user = build(:user, email: email)
          failing_user.errors.add(:email, "is invalid")

          allow(User).to receive(:find_or_initialize_by).and_return(failing_user)
          allow(failing_user).to receive(:new_record?).and_return(true)
          allow(failing_user).to receive(:save!).and_raise(ActiveRecord::RecordInvalid.new(failing_user))

          result = nil
          expect do
            result = invite_administrator
          end.not_to have_enqueued_mail(CompanyAdministratorMailer, :invitation_instructions)

          expect(result[:success]).to be false
          expect(result[:error_message]).to include("Email is invalid")
          expect(result[:field]).to eq(:email)
        end

        it "does not send email when database transaction fails" do
          failing_user = build(:user, email: email)
          failing_user.errors.add(:email, "is invalid")

          allow(User).to receive(:find_or_initialize_by).and_return(failing_user)
          allow(failing_user).to receive(:new_record?).and_return(true)

          allow(failing_user).to receive(:save!).and_raise(ActiveRecord::RecordInvalid.new(failing_user))

          result = nil
          expect do
            perform_enqueued_jobs do
              result = invite_administrator
            end
          end.not_to change { ActionMailer::Base.deliveries.count }

          expect(result[:success]).to be false
          expect(result[:error_message]).to include("Email is invalid")
          expect(result[:field]).to eq(:email)
        end
      end
    end
  end

  describe ".send_email" do
    let!(:company_administrator) { create(:company_administrator, company: company, user: create(:user, email: email)) }

    context "when CompanyAdministrator record is deleted before email is sent" do
      it "handles missing record gracefully" do
        admin_id = company_administrator.id
        company_administrator.destroy!

        expect do
          perform_enqueued_jobs do
            described_class.send_email(admin_id: admin_id, url: invitation_url)
          end
        end.not_to change { ActionMailer::Base.deliveries.count }
      end
    end
  end
end
