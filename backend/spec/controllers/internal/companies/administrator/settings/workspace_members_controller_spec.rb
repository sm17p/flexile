# frozen_string_literal: true

require "spec_helper"

RSpec.describe Internal::Companies::Administrator::Settings::WorkspaceMembersController, type: :controller do
  let(:company) { create(:company) }
  let(:admin_user) { create(:user) }
  let(:regular_user) { create(:user) }
  let(:batch_service_double) { double("BatchManageWorkspaceMembers") }

  before do
    Current.reset
    create(:company_administrator, user: admin_user, company: company)
    @request.env["devise.mapping"] = Devise.mappings[:user]
    allow(BatchManageWorkspaceMembers).to receive(:new).and_return(batch_service_double)

    # Mock Clerk authentication
    allow(controller).to receive(:clerk).and_return(double("clerk", user?: true))
  end

  describe "POST #create" do
    context "when authenticated as company administrator" do
      before do
        current_context = CurrentContext.new(user: admin_user, company: company)
        allow(controller).to receive(:current_context).and_return(current_context)
        allow(Current).to receive(:user).and_return(admin_user)
        allow(Current).to receive(:company).and_return(company)
      end

      context "with valid role assignments" do
        let(:valid_workspace_members_params) do
          [{ email: "new.admin@example.com", role: "admin" }]
        end

        let(:successful_service_response) do
          {
            success: true,
            invited_count: 1,
            updated_count: 0,
            total_processed: 1,
          }
        end

        before do
          allow(BatchManageWorkspaceMembers).to receive(:new).and_return(batch_service_double)
          allow(batch_service_double).to receive(:perform).and_return(successful_service_response)
        end

        it "happy path: returns 201 created status with success response" do
          post :create, params: {
            company_id: company.external_id,
            members: valid_workspace_members_params,
          }

          expect(response).to have_http_status(:created)
        end

        it "happy path: returns JSON response with correct success format" do
          post :create, params: {
            company_id: company.external_id,
            members: valid_workspace_members_params,
          }

          expect(response.content_type).to eq("application/json; charset=utf-8")

          response_data = JSON.parse(response.body)
          expect(response_data).to include(
            "success" => true,
            "invited_count" => 1,
            "updated_count" => 0,
            "total_processed" => 1
          )
        end

        it "happy path: delegates workspace member management to BatchManageWorkspaceMembers service" do
          post :create, params: {
            company_id: company.external_id,
            members: valid_workspace_members_params,
          }

          expect(BatchManageWorkspaceMembers).to have_received(:new)
          expect(batch_service_double).to have_received(:perform)
        end
      end

      context "with invalid role assignments" do
        let(:invalid_workspace_members_params) do
          [{ email: "test@example.com", role: "invalid_role" }]
        end

        it "edge case: returns 403 forbidden status when role is not manageable" do
          post :create, params: {
            company_id: company.external_id,
            members: invalid_workspace_members_params,
          }

          expect(response).to have_http_status(:forbidden)
        end

        it "edge case: returns JSON error response with specific role validation message" do
          post :create, params: {
            company_id: company.external_id,
            members: invalid_workspace_members_params,
          }

          expect(response.content_type).to eq("application/json; charset=utf-8")

          response_data = JSON.parse(response.body)
          expect(response_data["error"]).to include("Cannot manage roles: invalid_role")
        end

        it "edge case: does not call BatchManageWorkspaceMembers service when role validation fails" do
          expect(BatchManageWorkspaceMembers).not_to receive(:new)

          post :create, params: {
            company_id: company.external_id,
            members: invalid_workspace_members_params,
          }
        end
      end

      context "when service returns failure" do
        let(:valid_workspace_members_params) do
          [{ email: "invalid-email-format", role: "admin" }]
        end

        let(:failed_service_response) do
          {
            success: false,
            errors: [{ field: "email", error_message: "Invalid email format" }],
            invited_count: 0,
            updated_count: 0,
          }
        end

        before do
          allow(batch_service_double).to receive(:perform).and_return(failed_service_response)
        end

        it "edge case: returns 422 unprocessable entity status when service fails" do
          post :create, params: {
            company_id: company.external_id,
            members: valid_workspace_members_params,
          }

          expect(response).to have_http_status(:unprocessable_entity)
        end

        it "edge case: returns JSON response with service error details" do
          post :create, params: {
            company_id: company.external_id,
            members: valid_workspace_members_params,
          }

          expect(response.content_type).to eq("application/json; charset=utf-8")

          response_data = JSON.parse(response.body)
          expect(response_data).to include(
            "success" => false,
            "errors" => [{ "field" => "email", "error_message" => "Invalid email format" }],
            "invited_count" => 0,
            "updated_count" => 0
          )
        end
      end

      context "with empty workspace members array" do
        it "edge case: allows request and delegates to service when no workspace members provided" do
          allow(batch_service_double).to receive(:perform).and_return({
            success: true,
            invited_count: 0,
            updated_count: 0,
            total_processed: 0,
          })

          post :create, params: {
            company_id: company.external_id,
            members: [],
          }

          expect(response).to have_http_status(:created)
          expect(BatchManageWorkspaceMembers).to have_received(:new)
        end
      end

      context "with mixed valid and invalid roles" do
        let(:mixed_workspace_members_params) do
          [
            { email: "admin@example.com", role: "admin" },
            { email: "invalid@example.com", role: "invalid_role" }
          ]
        end

        it "rejects entire request when any role is invalid" do
          expect(BatchManageWorkspaceMembers).not_to receive(:new)

          post :create, params: {
            company_id: company.external_id,
            members: mixed_workspace_members_params,
          }

          expect(response).to have_http_status(:forbidden)
        end
      end
    end

    context "when authenticated as regular user without admin privileges" do
      before do
        # Mock the current_context for a regular user
        Current.reset
        current_context = CurrentContext.new(user: regular_user, company: company)
        allow(controller).to receive(:current_context).and_return(current_context)
        allow(Current).to receive(:user).and_return(regular_user)
        allow(Current).to receive(:company).and_return(company)

        # Mock Clerk for regular user
        allow(controller).to receive(:clerk).and_return(double("clerk", user?: true))
      end

      it "returns 403 forbidden status for unauthorized access" do
        post :create, params: {
          company_id: company.external_id,
          members: [{ email: "test@example.com", role: "admin" }],
        }

        expect(response).to have_http_status(:forbidden)
      end

      it "returns JSON error response with authorization message" do
        post :create, params: {
          company_id: company.external_id,
          members: [{ email: "test@example.com", role: "admin" }],
        }

        expect(response.content_type).to eq("application/json; charset=utf-8")

        response_data = JSON.parse(response.body)
        expect(response_data).to have_key("error")
        expect(response_data["success"]).to be false
      end

      it "does not call BatchManageWorkspaceMembers service when unauthorized" do
        expect(BatchManageWorkspaceMembers).not_to receive(:new)

        post :create, params: {
          company_id: company.external_id,
          members: [{ email: "test@example.com", role: "admin" }],
        }
      end
    end

    context "when company does not exist" do
      before do
        current_context = CurrentContext.new(user: admin_user, company: company)
        allow(controller).to receive(:current_context).and_return(current_context)
        allow(Current).to receive(:user).and_return(admin_user)
        allow(Current).to receive(:company).and_return(company)
      end
    end

    context "when no user is authenticated" do
      before do
        # Mock unauthenticated state
        current_context = CurrentContext.new(user: nil, company: company)
        allow(controller).to receive(:current_context).and_return(current_context)
        allow(Current).to receive(:user).and_return(nil)
        allow(Current).to receive(:company).and_return(company)

        # Mock Clerk for unauthenticated user
        allow(controller).to receive(:clerk).and_return(double("clerk", user?: false))
      end

      it "returns 403 forbidden status for unauthenticated requests" do
        post :create, params: {
          company_id: company.external_id,
          members: [{ email: "test@example.com", role: "admin" }],
        }

        expect(response).to have_http_status(:forbidden)
      end
    end
  end
end
