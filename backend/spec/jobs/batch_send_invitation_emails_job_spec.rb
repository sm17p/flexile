# frozen_string_literal: true

require "spec_helper"

RSpec.describe BatchSendInvitationEmailsJob do
  let(:company) { create(:company) }
  let(:admin_user) { create(:user) }
  let(:lawyer_user) { create(:user) }
  let(:company_admin) { create(:company_administrator, company: company, user: admin_user) }
  let(:company_lawyer) { create(:company_lawyer, company: company, user: lawyer_user) }

  let(:existing_user_invitations) do
    [
      {
        "company_member_id" => company_admin.id,
        "company_member_type" => "CompanyAdministrator",
        "user_id" => admin_user.id,
        "role" => "admin",
        "email" => admin_user.email,
        "type" => "existing_user_invitation",
      }
    ]
  end

  let(:new_user_invitations) do
    [
      {
        "email" => "newadmin@example.com",
        "role" => "admin",
        "company_id" => company.id,
        "current_user_id" => admin_user.id,
        "type" => "new_user_invitation",
      }
    ]
  end

  before do
    allow_any_instance_of(User).to receive(:create_clerk_invitation).and_return("http://invitation-url")
  end

  describe "#perform" do
    context "existing user invitations" do
      it "sends invitation emails for existing users" do
        expect(CompanyAdministratorMailer).to receive(:invitation_instructions)
          .with(admin_id: company_admin.id, url: "http://invitation-url")
          .and_return(double(deliver_now: true))

        described_class.new.perform(existing_user_invitations)
      end
    end

    context "new user invitations" do
      it "processes new user invitations without crashing" do
        expect { described_class.new.perform(new_user_invitations) }.not_to raise_error
      end
    end

    context "mixed invitation types" do
      it "handles both new and existing user invitations" do
        mixed_invitations = existing_user_invitations + new_user_invitations
        expect { described_class.new.perform(mixed_invitations) }.not_to raise_error
      end
    end

    context "error handling" do
      it "handles invalid user IDs gracefully" do
        invalid_invitations = [
          {
            "company_member_id" => company_admin.id,
            "company_member_type" => "CompanyAdministrator",
            "user_id" => 99999,
            "role" => "admin",
            "email" => "missing@example.com",
            "type" => "existing_user_invitation",
          }
        ]

        expect(Rails.logger).to receive(:warn).with(/Failed to send invitation email/)
        expect { described_class.new.perform(invalid_invitations) }.not_to raise_error
      end
    end

    context "with empty invitations array" do
      it "handles empty array gracefully" do
        expect { described_class.new.perform([]) }.not_to raise_error
      end
    end
  end
end
