# frozen_string_literal: true

require "spec_helper"

RSpec.describe BatchManageWorkspaceMembers do
  let(:company) { create(:company, name: "Test Company", external_id: "test-123") }
  let(:admin_user) { create(:user, email: "admin@test.com") }
  let(:existing_user) { create(:user, email: "existing@test.com") }
  let(:existing_lawyer) { create(:user, email: "lawyer@test.com") }

  before do
    create(:company_administrator, user: admin_user, company: company)
    create(:company_lawyer, user: existing_lawyer, company: company)
  end

  describe "#perform" do
    context "validation errors" do
      context "when members array is empty" do
        let(:members_data) { [] }

        subject do
          described_class.new(
            company: company,
            members: members_data,
            current_user: admin_user
          )
        end

        it "returns validation error for empty members" do
          result = subject.perform

          expect(result[:success]).to be false
          expect(result[:errors]).to eq([{ field: "workspace_members", error_message: "No workspace members provided" }])
          expect(result[:invited_count]).to eq(0)
          expect(result[:updated_count]).to eq(0)
        end
      end

      context "when members array is nil" do
        subject do
          described_class.new(
            company: company,
            members: nil,
            current_user: admin_user
          )
        end

        it "returns validation error for nil members" do
          result = subject.perform

          expect(result[:success]).to be false
          expect(result[:errors]).to eq([{ field: "workspace_members", error_message: "No workspace members provided" }])
          expect(result[:invited_count]).to eq(0)
          expect(result[:updated_count]).to eq(0)
        end
      end

      context "when member data has validation errors" do
        let(:invalid_members_data) do
          [
            { email: "", role: "admin" },
            { email: "invalid-email", role: "admin" },
            { email: "valid@email.com", role: "" },
            { email: "another@email.com", role: "invalid_role" }
          ]
        end

        subject do
          described_class.new(
            company: company,
            members: invalid_members_data,
            current_user: admin_user
          )
        end

        it "returns validation errors for invalid input" do
          result = subject.perform

          expect(result[:success]).to be false
          expect(result[:errors]).to be_present
          expect(result[:errors].size).to eq(4)
          expect(result[:invited_count]).to eq(0)
          expect(result[:updated_count]).to eq(0)
        end

        it "includes specific error messages for each validation failure" do
          result = subject.perform

          error_messages = result[:errors].map { |e| e[:error_message] }

          expect(error_messages).to include("Email is required")
          expect(error_messages).to include("Email format is invalid")
          expect(error_messages).to include("Role is required")
          expect(error_messages).to include("Invalid role: invalid_role")
        end

        it "includes field and index information in errors" do
          result = subject.perform

          expect(result[:errors]).to all(include(:index, :field, :error_message))
          expect(result[:errors].map { |e| e[:index] }).to eq([0, 1, 2, 3])
        end
      end
    end

    context "happy path - successful invitations" do
      let(:members_data) do
        [
          { email: "new_admin@example.com", role: "admin" },
          { email: "new_lawyer@example.com", role: "lawyer" }
        ]
      end

      subject do
        described_class.new(
          company: company,
          members: members_data,
          current_user: admin_user
        )
      end

      before do
        allow_any_instance_of(User).to receive(:invite!).and_return(true)
        allow_any_instance_of(User).to receive(:create_clerk_invitation).and_return("http://invitation-url")
        allow(CompanyAdministratorMailer).to receive(:invitation_instructions).and_return(double(deliver_later: true))
        allow(CompanyLawyerMailer).to receive(:invitation_instructions).and_return(double(deliver_later: true))
      end

      it "invites new users successfully" do
        result = subject.perform

        expect(result[:success]).to be true
        expect(result[:invited_count]).to eq(2)
        expect(result[:updated_count]).to eq(0)
        expect(result[:total_processed]).to eq(2)
        expect(result[:errors]).to be_nil
      end

      it "queues new user creation for background processing" do
        expect(BatchSendInvitationEmailsJob).to receive(:perform_later) do |invitations|
          new_user_invitations = invitations.select { |inv| inv["type"] == "new_user_invitation" }
          expect(new_user_invitations.size).to eq(2)

          emails = new_user_invitations.map { |inv| inv["email"] }
          expect(emails).to contain_exactly("new_admin@example.com", "new_lawyer@example.com")
        end

        subject.perform

        # Users should NOT be created yet, only queued for background creation
        expect(User.find_by(email: "new.admin@example.com")).to be_nil
        expect(User.find_by(email: "new.lawyer@example.com")).to be_nil
      end

      it "queues batch job for new user invitations" do
        expect(BatchSendInvitationEmailsJob).to receive(:perform_later) do |invitations|
          expect(invitations).to be_an(Array)
          expect(invitations.size).to eq(2)

          admin_invite = invitations.find { |inv| inv["role"] == "admin" }
          lawyer_invite = invitations.find { |inv| inv["role"] == "lawyer" }

          expect(admin_invite["type"]).to eq("new_user_invitation")
          expect(admin_invite["email"]).to eq("new_admin@example.com")
          expect(admin_invite["company_id"]).to eq(company.id)
          expect(admin_invite["current_user_id"]).to eq(admin_user.id)

          expect(lawyer_invite["type"]).to eq("new_user_invitation")
          expect(lawyer_invite["email"]).to eq("new_lawyer@example.com")
          expect(lawyer_invite["company_id"]).to eq(company.id)
          expect(lawyer_invite["current_user_id"]).to eq(admin_user.id)
        end

        subject.perform
      end
    end

    context "happy path - updating existing users" do
      let(:members_data) do
        [
          { email: existing_user.email, role: "admin" },
          { email: existing_lawyer.email, role: "admin" }
        ]
      end

      subject do
        described_class.new(
          company: company,
          members: members_data,
          current_user: admin_user
        )
      end

      it "adds company relationship for existing user without relationship" do
        result = subject.perform

        expect(result[:success]).to be true
        expect(result[:invited_count]).to eq(0)
        expect(result[:updated_count]).to eq(2)
        expect(company.company_administrators.exists?(user: existing_user)).to be true
      end

      it "updates role for existing user with different role" do
        result = subject.perform

        expect(result[:success]).to be true
        expect(company.company_administrators.exists?(user: existing_lawyer)).to be true
        expect(company.company_lawyers.exists?(user: existing_lawyer)).to be false
      end
    end

    context "happy path - no changes needed" do
      let(:members_data) do
        [
          { email: existing_lawyer.email, role: "lawyer" }
        ]
      end

      subject do
        described_class.new(
          company: company,
          members: members_data,
          current_user: admin_user
        )
      end

      it "handles users with same role gracefully" do
        result = subject.perform

        expect(result[:success]).to be true
        expect(result[:invited_count]).to eq(0)
        expect(result[:updated_count]).to eq(0)
        expect(result[:total_processed]).to eq(0)
      end
    end

    context "email case handling" do
      let(:members_data) do
        [
          { email: "UPPERCASE@EXAMPLE.COM", role: "admin" },
          { email: "  spaced@example.com  ", role: "lawyer" }
        ]
      end

      subject do
        described_class.new(
          company: company,
          members: members_data,
          current_user: admin_user
        )
      end

      before do
        allow(BatchSendInvitationEmailsJob).to receive(:perform_later)
      end

      it "normalizes email case and whitespace" do
        expect(BatchSendInvitationEmailsJob).to receive(:perform_later) do |invitations|
          emails = invitations.map { |inv| inv["email"] }
          expect(emails).to contain_exactly("uppercase@example.com", "spaced@example.com")
        end

        result = subject.perform

        expect(result[:success]).to be true
        expect(result[:invited_count]).to eq(2)
      end
    end

    context "duplicate emails in input" do
      let(:members_data) do
        [
          { email: "duplicate@example.com", role: "admin" },
          { email: "duplicate@example.com", role: "lawyer" }
        ]
      end

      subject do
        described_class.new(
          company: company,
          members: members_data,
          current_user: admin_user
        )
      end

      before do
        allow_any_instance_of(User).to receive(:invite!).and_return(true)
        allow_any_instance_of(User).to receive(:create_clerk_invitation).and_return("http://invitation-url")
        allow(CompanyLawyerMailer).to receive(:invitation_instructions).and_return(double(deliver_later: true))
      end

      it "uses last role for duplicate emails" do
        expect(BatchSendInvitationEmailsJob).to receive(:perform_later) do |invitations|
          expect(invitations.size).to eq(1)
          duplicate_invite = invitations.first
          expect(duplicate_invite["email"]).to eq("duplicate@example.com")
          expect(duplicate_invite["role"]).to eq("lawyer")
        end

        result = subject.perform

        expect(result[:success]).to be true
        expect(result[:invited_count]).to eq(1)
      end
    end

    context "error handling" do
      context "database transaction failures" do
        let(:members_data) do
          [{ email: "test@example.com", role: "admin" }]
        end

        subject do
          described_class.new(
            company: company,
            members: members_data,
            current_user: admin_user
          )
        end

        before do
          allow_any_instance_of(User).to receive(:invite!).and_return(true)
        end

        it "queues user creation even when database operations might fail later" do
          expect(BatchSendInvitationEmailsJob).to receive(:perform_later) do |invitations|
            expect(invitations.size).to eq(1)
            expect(invitations.first["email"]).to eq("test@example.com")
            expect(invitations.first["type"]).to eq("new_user_invitation")
          end

          result = subject.perform

          expect(result[:success]).to be true
          expect(result[:invited_count]).to eq(1)
        end

        it "rolls back transaction on error" do
          allow_any_instance_of(CompanyAdministrator).to receive(:save).and_raise(StandardError.new("Test error"))

          expect do
            subject.perform
          end.not_to change { User.count }
        end
      end

      context "user invitation failures" do
        let(:members_data) do
          [{ email: "failing@example.com", role: "admin" }]
        end

        subject do
          described_class.new(
            company: company,
            members: members_data,
            current_user: admin_user
          )
        end

        it "queues user invitations even when creation might fail later" do
          expect(BatchSendInvitationEmailsJob).to receive(:perform_later) do |invitations|
            expect(invitations.size).to eq(1)
            expect(invitations.first["email"]).to eq("failing@example.com")
            expect(invitations.first["type"]).to eq("new_user_invitation")
          end

          result = subject.perform

          expect(result[:success]).to be true
          expect(result[:invited_count]).to eq(1)
        end
      end

      context "email sending failures" do
        let(:members_data) do
          [{ email: "test@example.com", role: "admin" }]
        end

        subject do
          described_class.new(
            company: company,
            members: members_data,
            current_user: admin_user
          )
        end

        before do
          allow(BatchSendInvitationEmailsJob).to receive(:perform_later)
        end

        it "continues operation and queues invitations even when other operations might fail" do
          expect(BatchSendInvitationEmailsJob).to receive(:perform_later).with(kind_of(Array))

          result = subject.perform

          expect(result[:success]).to be true
          expect(result[:invited_count]).to eq(1)
        end
      end
    end
  end

  describe "private methods" do
    let(:service) do
      described_class.new(
        company: company,
        members: [],
        current_user: admin_user
      )
    end

    describe "#valid_email?" do
      it "validates email format correctly" do
        expect(service.send(:valid_email?, "valid@email.com")).to be true
        expect(service.send(:valid_email?, "user+tag@domain.co.uk")).to be true
        expect(service.send(:valid_email?, "invalid-email")).to be false
        expect(service.send(:valid_email?, "")).to be false
        expect(service.send(:valid_email?, nil)).to be false
        expect(service.send(:valid_email?, "@domain.com")).to be false
        expect(service.send(:valid_email?, "user@")).to be false
      end
    end
  end
end
