# frozen_string_literal: true

RSpec.describe InviteAdministrator do
  let!(:company) { create(:company, :completed_onboarding) }
  let(:email) { "admin@example.com" }
  let!(:current_user) { create(:user) }

  subject(:invite_administrator) { described_class.new(company:, email:, current_user:).perform }

  context "when inviting a new user" do
    it "creates a new user and company_administrator with correct attributes", :vcr do
      result = nil
      expect do
        result = invite_administrator
      end.to change(User, :count).by(1)
         .and change(CompanyAdministrator, :count).by(1)
         .and have_enqueued_mail(CompanyAdministratorMailer, :invitation_instructions)

      expect(result[:success]).to be true

      user = User.last
      company_administrator = CompanyAdministrator.last

      expect(user.email).to eq(email)
      expect(company_administrator.company).to eq(company)
      expect(company_administrator.user).to eq(user)
      expect(user.invited_by).to eq(current_user)
    end

    it "sends email with correct parameters" do
      allow_any_instance_of(User).to receive(:create_clerk_invitation).and_return("http://invitation-url")

      expect(CompanyAdministratorMailer).to receive(:invitation_instructions)
        .with(admin_id: kind_of(Integer), url: "http://invitation-url")
        .and_return(double(deliver_later: true))

      invite_administrator
    end
  end

  context "when inviting an existing user" do
    let!(:company_administrator) { create(:company_administrator, company:, user: create(:user, email:)) }

    it "returns an error and does not create new records or send emails" do
      result = nil
      expect do
        result = invite_administrator
      end.not_to have_enqueued_mail(CompanyAdministratorMailer, :invitation_instructions)

      expect(result[:success]).to be false
      expect(result[:error_message]).to eq("Email has already been taken")
      expect(result[:field]).to eq("email")
    end
  end

  context "email case handling" do
    let(:email) { "ADmIN@example.com" }

    it "normalizes email case when creating user", :vcr do
      result = invite_administrator

      expect(result[:success]).to be true
      user = User.last
      expect(user.email).to eq("admin@example.com")
    end
  end

  context "error handling" do
    context "when user invitation fails" do
      it "returns appropriate error message" do
        failing_user = build(:user, email: email)
        failing_user.errors.add(:email, "is invalid")

        allow(User).to receive(:find_or_initialize_by).and_return(failing_user)
        allow(failing_user).to receive(:persisted?).and_return(false)
        allow(failing_user).to receive(:invite!).and_return(failing_user)

        result = invite_administrator

        expect(result[:success]).to be false
        expect(result[:error_message]).to include("Email is invalid")
        expect(result[:field]).to eq(:email)
      end
    end

    context "when company administrator relationship fails" do
      it "returns appropriate error message" do
        user = build(:user, email: email)
        company_administrator = build(:company_administrator)
        company_administrator.errors.add(:user, "is required")

        allow(User).to receive(:find_or_initialize_by).and_return(user)
        allow(user).to receive(:persisted?).and_return(false)
        allow(user).to receive(:company_administrators).and_return(double(find_or_initialize_by: company_administrator))
        allow(user).to receive(:invite!).and_return(user)
        allow(user).to receive(:errors).and_return(double(blank?: false, any?: true, first: double(attribute: :user, full_message: "User is required")))
        allow(user).to receive(:create_clerk_invitation).and_return("http://invitation-url")

        result = invite_administrator

        expect(result[:success]).to be false
        expect(result[:error_message]).to include("User is required")
        expect(result[:field]).to eq(:user)
      end
    end
  end

  describe ".send_email" do
    let!(:company_administrator) { create(:company_administrator, company:) }
    let(:url) { "http://invitation-url" }

    it "delegates to CompanyAdministratorMailer with correct parameters" do
      expect(CompanyAdministratorMailer).to receive(:invitation_instructions)
        .with(admin_id: company_administrator.id, url: url)
        .and_return(double(deliver_later: true))

      described_class.send_email(admin_id: company_administrator.id, url: url)
    end
  end
end
