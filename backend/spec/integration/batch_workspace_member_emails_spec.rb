# frozen_string_literal: true

require "spec_helper"

RSpec.describe "BatchManageWorkspaceMembers email integration", type: :integration do
  let(:company) { create(:company) }
  let(:admin_user) { create(:user) }

  before do
    create(:company_administrator, user: admin_user, company: company)
    allow_any_instance_of(User).to receive(:invite!).and_return(true)
    allow_any_instance_of(User).to receive(:create_clerk_invitation).and_return("http://invitation-url")
  end

  describe "email batching behavior" do
    it "queues a single batch job for multiple invitations instead of individual emails" do
      members_data = [
        { email: "admin1@example.com", role: "admin" },
        { email: "admin2@example.com", role: "admin" },
        { email: "lawyer1@example.com", role: "lawyer" },
        { email: "lawyer2@example.com", role: "lawyer" }
      ]

      # Expect one batch job with all invitations
      expect(BatchSendInvitationEmailsJob).to receive(:perform_later) do |invitations|
        expect(invitations).to be_an(Array)
        expect(invitations.size).to eq(4)

        admin_invites = invitations.select { |inv| inv["role"] == "admin" }
        lawyer_invites = invitations.select { |inv| inv["role"] == "lawyer" }

        expect(admin_invites.size).to eq(2)
        expect(lawyer_invites.size).to eq(2)

        # Verify structure of invitation data
        invitations.each do |invite|
          expect(invite).to have_key("company_member_id")
          expect(invite).to have_key("company_member_type")
          expect(invite).to have_key("user_id")
          expect(invite).to have_key("role")
        end
      end

      # Should NOT call individual mailers during service execution
      expect(CompanyAdministratorMailer).not_to receive(:invitation_instructions)
      expect(CompanyLawyerMailer).not_to receive(:invitation_instructions)

      service = BatchManageWorkspaceMembers.new(
        company: company,
        members: members_data,
        current_user: admin_user
      )

      result = service.perform

      expect(result[:success]).to be true
      expect(result[:invited_count]).to eq(4)
    end

    it "does not queue any email job when no invitations are needed" do
      existing_admin = create(:user)
      create(:company_administrator, user: existing_admin, company: company)

      members_data = [
        { email: existing_admin.email, role: "admin" }
      ]

      expect(BatchSendInvitationEmailsJob).not_to receive(:perform_later)

      service = BatchManageWorkspaceMembers.new(
        company: company,
        members: members_data,
        current_user: admin_user
      )

      result = service.perform

      expect(result[:success]).to be true
      expect(result[:invited_count]).to eq(0)
      expect(result[:updated_count]).to eq(0)
    end

    it "only queues emails after successful database transaction" do
      members_data = [
        { email: "new@example.com", role: "admin" }
      ]

      # Simulate database failure
      allow_any_instance_of(User).to receive(:invite!).and_raise(ActiveRecord::RecordInvalid.new(User.new))

      expect(BatchSendInvitationEmailsJob).not_to receive(:perform_later)

      service = BatchManageWorkspaceMembers.new(
        company: company,
        members: members_data,
        current_user: admin_user
      )

      result = service.perform

      expect(result[:success]).to be false
    end
  end

  describe "BatchSendInvitationEmailsJob execution" do
    let(:new_admin) { create(:user) }
    let(:new_lawyer) { create(:user) }
    let(:company_admin) { create(:company_administrator, company: company, user: new_admin) }
    let(:company_lawyer) { create(:company_lawyer, company: company, user: new_lawyer) }

    it "sends individual emails when job is executed" do
      invitations = [
        {
          "company_member_id" => company_admin.id,
          "company_member_type" => "CompanyAdministrator",
          "user_id" => new_admin.id,
          "role" => "admin",
        },
        {
          "company_member_id" => company_lawyer.id,
          "company_member_type" => "CompanyLawyer",
          "user_id" => new_lawyer.id,
          "role" => "lawyer",
        }
      ]

      expect(CompanyAdministratorMailer).to receive(:invitation_instructions)
        .with(admin_id: company_admin.id, url: "http://invitation-url")
        .and_return(double(deliver_now: true))

      expect(CompanyLawyerMailer).to receive(:invitation_instructions)
        .with(lawyer_id: company_lawyer.id, url: "http://invitation-url")
        .and_return(double(deliver_now: true))

      BatchSendInvitationEmailsJob.perform_now(invitations)
    end
  end
end
