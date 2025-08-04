import { db } from "@test/db";
import { companiesFactory } from "@test/factories/companies";
import { companyAdministratorsFactory } from "@test/factories/companyAdministrators";
import { companyContractorsFactory } from "@test/factories/companyContractors";
import { companyInvestorsFactory } from "@test/factories/companyInvestors";
import { companyLawyersFactory } from "@test/factories/companyLawyers";
import { usersFactory } from "@test/factories/users";
import { login } from "@test/helpers/auth";
import { expect, test } from "@test/index";
import { and, eq } from "drizzle-orm";
import { companies, companyAdministrators, users } from "@/db/schema";

test.describe("Manage workspace roles", () => {
  let company: typeof companies.$inferSelect;
  let primaryAdmin: typeof users.$inferSelect;
  let secondAdmin: typeof users.$inferSelect;
  let contractorUser: typeof users.$inferSelect;
  let investorUser: typeof users.$inferSelect;
  let lawyerUser: typeof users.$inferSelect;
  let multiRoleUser: typeof users.$inferSelect;

  test.beforeEach(async () => {
    // Create company with primary admin
    ({ company, adminUser: primaryAdmin } = await companiesFactory.createCompletedOnboarding());

    // Create second admin
    const { user: secondAdminUser } = await usersFactory.create({ legalName: "Second Admin" });
    await companyAdministratorsFactory.create({ userId: secondAdminUser.id, companyId: company.id });
    secondAdmin = secondAdminUser;

    // Create contractor
    const { user: contractorUserData } = await usersFactory.create({ legalName: "John Contractor" });
    await companyContractorsFactory.create({
      userId: contractorUserData.id,
      companyId: company.id,
      role: "Senior Developer",
    });
    contractorUser = contractorUserData;

    // Create investor
    const { user: investorUserData } = await usersFactory.create({ legalName: "Jane Investor" });
    await companyInvestorsFactory.create({ userId: investorUserData.id, companyId: company.id });
    investorUser = investorUserData;

    // Create lawyer
    const { user: lawyerUserData } = await usersFactory.create({ legalName: "Bob Lawyer" });
    await companyLawyersFactory.create({ userId: lawyerUserData.id, companyId: company.id });
    lawyerUser = lawyerUserData;

    // Create user with multiple roles (admin + investor + lawyer)
    const { user: multiRoleUserData } = await usersFactory.create({ legalName: "Alice MultiRole" });
    await companyAdministratorsFactory.create({ userId: multiRoleUserData.id, companyId: company.id });
    await companyInvestorsFactory.create({ userId: multiRoleUserData.id, companyId: company.id });
    await companyLawyersFactory.create({ userId: multiRoleUserData.id, companyId: company.id });
    multiRoleUser = multiRoleUserData;
  });

  test.describe("Add Members", () => {
    test.beforeEach(async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members?addMembers=true");
    });

    test("allows adding multiple members with different roles", async ({ page }) => {
      const members = [
        { email: "bulkadmin1@example.com", role: "Admin" },
        { email: "bulkadmin2@example.com", role: "Admin" },
        { email: "bulklawyer1@example.com", role: "Lawyer" },
        { email: "bulklawyer2@example.com", role: "Lawyer" },
        { email: "bulkadmin3@example.com", role: "Admin" },
      ];

      await page
        .getByPlaceholder("user1@gmail.com, user2@gmail.com, user3@gmail.com")
        .fill(members.map((m) => m.email).join(","));
      await page.getByRole("button", { name: "Process emails" }).click();

      const comboboxLocator = page
        .getByLabel("Add members")
        .locator("div")
        .filter({ hasText: "Individual email addresses" })
        .getByRole("combobox");

      let i = 0;
      for (const { role } of members) {
        await comboboxLocator.nth(i).click();

        await page.waitForSelector('[role="listbox"]', { state: "visible" });
        await page.locator('[role="listbox"]').getByRole("option", { name: role }).click();
        await page.waitForSelector('[role="listbox"]', { state: "hidden" });

        i += 1;
      }

      await expect(page.getByRole("button", { name: "Add 5 Members" })).toBeVisible();

      await page.getByRole("button", { name: "Add 5 Members" }).click();

      await expect(page.getByText(/5 members invited/u)).toBeVisible();
    });

    test("displays form email invalidation error", async ({ page }) => {
      await page.getByPlaceholder("Enter email address").fill("invalid-email-format");
      await page.getByRole("button", { name: "Add 1 Member" }).click();

      await expect(page.getByText("Please enter a valid email address")).toBeVisible();
    });

    test("displays form bulk entry email invalid error", async ({ page }) => {
      await page
        .getByPlaceholder("user1@gmail.com, user2@gmail.com, user3@gmail.com")
        .fill("valid@example.com, invalid-email, another@example.com");
      await page.getByRole("button", { name: "Process emails" }).click();

      await expect(page.getByText(/Invalid email format/u)).toBeVisible();
    });

    test("displays form bulk entry email limit error", async ({ page }) => {
      const emails = Array.from({ length: 101 }).map((_, index) => `quick${index}@example.com`);
      await page.getByPlaceholder("user1@gmail.com, user2@gmail.com, user3@gmail.com").fill(emails.join(","));
      await page.getByRole("button", { name: "Process emails" }).click();

      await expect(page.getByText(/Bulk additions are limited to 100 emails/u)).toBeVisible();
    });

    test("displays form bulk entry email duplication errors", async ({ page }) => {
      await page
        .getByPlaceholder("user1@gmail.com, user2@gmail.com, user3@gmail.com")
        .fill("valid@example.com, valid@example.com");
      await page.getByRole("button", { name: "Process emails" }).click();

      await expect(page.getByText(/Duplicate emails found/u)).toBeVisible();
    });

    test("updates existing user roles along with adding new members", async ({ page }) => {
      await page.goto("/settings/administrator/members");

      await expect(page.getByText("Admin", { exact: true })).toHaveCount(2);
      await expect(page.getByText("Lawyer", { exact: true })).toHaveCount(1);
      await expect(page.getByText("Member", { exact: true })).toHaveCount(2);
      await page.getByRole("button", { name: "Add Members" }).click();

      await page
        .getByPlaceholder("user1@gmail.com, user2@gmail.com, user3@gmail.com")
        .fill([contractorUser.email, lawyerUser.email, secondAdmin.email, "newuser@example.com"].join(","));
      await page.getByRole("button", { name: "Process emails" }).click();

      const comboboxLocator = page
        .getByLabel("Add members")
        .locator("div")
        .filter({ hasText: "Individual email addresses" })
        .getByRole("combobox");

      await comboboxLocator.nth(0).click();
      await page.waitForSelector('[role="listbox"]', { state: "visible" });
      await page.locator('[role="listbox"]').getByRole("option", { name: "Admin" }).click();
      await page.waitForSelector('[role="listbox"]', { state: "hidden" });

      await comboboxLocator.nth(3).click();
      await page.waitForSelector('[role="listbox"]', { state: "visible" });
      await page.locator('[role="listbox"]').getByRole("option", { name: "Admin" }).click();
      await page.waitForSelector('[role="listbox"]', { state: "hidden" });

      await page.getByRole("button", { name: "Add 4 Members" }).click();

      await expect(page.getByText(/1 member invited and 2 roles updated/u)).toBeVisible();

      await page.waitForSelector("dialog", { state: "hidden" });

      await expect(page.getByText("Admin", { exact: true })).toHaveCount(2);
      await expect(page.getByText("Lawyer", { exact: true })).toHaveCount(2);
      await expect(page.getByText("Member", { exact: true })).toHaveCount(1);
      await expect(page.getByText(contractorUser.email)).toBeVisible();
    });

    test("shows add members modal", async ({ page }) => {
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Add members" })).toBeVisible();
    });

    test("shows success message immediately for bulk invitations", async ({ page }) => {
      const emails = Array.from({ length: 100 }).map((_, index) => `quick${index}@example.com`);
      await page.getByPlaceholder("user1@gmail.com, user2@gmail.com, user3@gmail.com").fill(emails.join(","));
      await page.getByRole("button", { name: "Process emails" }).click();

      await expect(page.getByRole("button", { name: "Bulk additions are limited to 100 emails" })).toBeVisible();

      // Record start time and submit
      const startTime = Date.now();
      await page.getByRole("button", { name: "Add 100 Members" }).click();
      await expect(page.getByText(/100 members invited/u)).toBeVisible();
      const responseTime = Date.now() - startTime;
      // Using 5 seconds as generous threshold - old system took 13+ seconds
      expect(responseTime).toBeLessThan(5000);
    });
  });

  test.describe("Admin List Display", () => {
    test("displays all workspace members with owner first", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Wait for the page to be fully loaded
      await page.waitForLoadState("networkidle");

      // Add a more specific wait for the table to appear
      await page.waitForSelector("table", { timeout: 10000 });

      // Check page title and description
      await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible();
      await expect(page.getByText("Use roles to grant deeper access to your workspace.")).toBeVisible();

      // Check table headers
      await expect(page.locator('th:has-text("Name")')).toBeVisible();
      await expect(page.locator('th:has-text("Role")')).toBeVisible();

      // Check that primary admin is first and marked as Owner
      const firstRow = page.getByRole("row").nth(1); // Skip header row
      await expect(firstRow.getByText(primaryAdmin.legalName || "")).toBeVisible();
      await expect(firstRow.getByText("Owner")).toBeVisible();
      await expect(firstRow.getByText("(You)")).toBeVisible();

      // Check that second admin shows as Admin
      await expect(page.getByText(secondAdmin.legalName || "")).toBeVisible();
      await expect(page.getByText("Admin").nth(1)).toBeVisible(); // nth(1) because Owner might also contain "Admin"

      // Check that lawyer shows as Lawyer
      await expect(page.getByText(lawyerUser.legalName || "")).toBeVisible();
      const lawyerRow = page.getByRole("row", { name: new RegExp(lawyerUser.legalName || "", "u") });
      await expect(lawyerRow.locator('[data-slot="badge"]').getByText("Lawyer")).toBeVisible();

      // Check that multi-role user shows as Admin (highest role)
      await expect(page.getByText(multiRoleUser.legalName || "")).toBeVisible();
      const multiRoleRow = page.getByRole("row", { name: new RegExp(multiRoleUser.legalName || "", "u") });
      await expect(multiRoleRow.getByText("Admin")).toBeVisible();

      // All users should be displayed (contractors, investors, etc.)
      await expect(page.getByText(contractorUser.legalName || "")).toBeVisible();
      await expect(page.getByText(investorUser.legalName || "")).toBeVisible();

      // Check that contractors and investors show as Members
      const contractorRow = page.getByRole("row", { name: new RegExp(contractorUser.legalName || "", "u") });
      await expect(contractorRow.locator('[data-slot="badge"]').getByText("Member")).toBeVisible();

      const investorRow = page.getByRole("row", { name: new RegExp(investorUser.legalName || "", "u") });
      await expect(investorRow.locator('[data-slot="badge"]').getByText("Member")).toBeVisible();
    });

    test("displays user names correctly (legal_name over preferred_name)", async ({ page }) => {
      // Create admin user with both legal_name and preferred_name
      const { user: adminWithBothNames } = await usersFactory.create({
        legalName: "John Legal Name",
        preferredName: "Johnny Preferred",
      });
      await companyAdministratorsFactory.create({
        userId: adminWithBothNames.id,
        companyId: company.id,
      });

      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Should display legal_name, not preferred_name
      await expect(page.getByText("John Legal Name")).toBeVisible();
    });

    test("shows email when user has no legal name", async ({ page }) => {
      // Create admin user with no legal name
      const { user: adminWithoutName } = await usersFactory.create({
        legalName: null,
        preferredName: null,
      });
      await companyAdministratorsFactory.create({
        userId: adminWithoutName.id,
        companyId: company.id,
      });

      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Wait for the page to be fully loaded
      await page.waitForLoadState("networkidle");
      await page.waitForSelector("table", { timeout: 10000 });

      // Should display email as fallback in the user's row
      const userRow = page.getByRole("row", { name: new RegExp(adminWithoutName.email, "u") });
      await expect(userRow).toBeVisible();
    });
  });

  test.describe("Authorization", () => {
    test("redirects non-admin users", async ({ page }) => {
      await login(page, contractorUser);
      await page.goto("/settings/administrator/members");

      await expect(page.getByRole("heading", { name: "Roles" })).not.toBeVisible();
    });

    test("allows second admin to access page", async ({ page }) => {
      await login(page, secondAdmin);
      await page.goto("/settings/administrator/members");

      await expect(page.getByRole("heading", { name: "Roles" })).toBeVisible();
      await expect(page.getByText("Use roles to grant deeper access to your workspace.")).toBeVisible();
    });
  });

  test.describe("Role Management", () => {
    test("allows promoting Member (contractor) to Admin", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Find contractor row and click ellipsis menu
      const contractorRow = page.getByRole("row", { name: new RegExp(contractorUser.legalName || "", "u") });
      const ellipsisButton = contractorRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();

      // Click "Make Admin" in dropdown
      await page.getByRole("menuitem", { name: "Make Admin" }).click();

      // Wait for role to update
      await expect(contractorRow.locator('[data-slot="badge"]').getByText("Admin")).toBeVisible();
    });

    test("allows promoting Member (investor) to Lawyer", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Find investor row and click ellipsis menu
      const investorRow = page.getByRole("row", { name: new RegExp(investorUser.legalName || "", "u") });
      const ellipsisButton = investorRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();

      // Click "Make Lawyer" in dropdown
      await page.getByRole("menuitem", { name: "Make Lawyer" }).click();

      // Wait for role to update
      await expect(investorRow.locator('[data-slot="badge"]').getByText("Lawyer")).toBeVisible();
    });
    test("allows changing role from Admin to Lawyer", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Find second admin row and click ellipsis menu
      const secondAdminRow = page.getByRole("row", { name: new RegExp(secondAdmin.legalName || "", "u") });
      const ellipsisButton = secondAdminRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();

      // Click "Make Lawyer" in dropdown
      await page.getByRole("menuitem", { name: "Make Lawyer" }).click();

      // Wait for role to update
      await expect(secondAdminRow.getByText("Lawyer")).toBeVisible();
    });

    test("allows changing role from Lawyer to Admin", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Find lawyer row and click ellipsis menu
      const lawyerRow = page.getByRole("row", { name: new RegExp(lawyerUser.legalName || "", "u") });
      const ellipsisButton = lawyerRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();

      // Click "Make Admin" in dropdown
      await page.getByRole("menuitem", { name: "Make Admin" }).click();

      // Wait for role to update
      await expect(lawyerRow.getByText("Admin")).toBeVisible();
    });

    test("allows revoking admin access", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Find second admin row and click ellipsis menu
      const secondAdminRow = page.getByRole("row", { name: new RegExp(secondAdmin.legalName || "", "u") });
      const ellipsisButton = secondAdminRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();

      // Click "Revoke Role" in dropdown
      await page.getByRole("menuitem", { name: "Revoke Role" }).click();

      // Confirm in modal
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText(/Remove admin access for/u)).toBeVisible();

      // Set up promise to wait for the tRPC mutation response
      const responsePromise = page.waitForResponse(
        (response) => response.url().includes("trpc/companies.revokeWorkspaceMemberRole") && response.status() === 200,
      );

      // Click the button
      await page.getByRole("button", { name: "Remove admin" }).click();

      // Wait for the actual backend response
      await responsePromise;

      // User should be removed from the list since they have no other company relationships
      await expect(page.getByText(secondAdmin.legalName || "")).not.toBeVisible();

      // Verify in database
      const adminRecord = await db.query.companyAdministrators.findFirst({
        where: and(eq(companyAdministrators.userId, secondAdmin.id), eq(companyAdministrators.companyId, company.id)),
      });
      expect(adminRecord).toBeFalsy();
    });

    test("allows revoking lawyer access", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Find lawyer row and click ellipsis menu
      const lawyerRow = page.getByRole("row", { name: new RegExp(lawyerUser.legalName || "", "u") });
      const ellipsisButton = lawyerRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();

      // Click "Revoke Role" in dropdown
      await page.getByRole("menuitem", { name: "Revoke Role" }).click();

      // Confirm in modal
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByText(/Remove lawyer access for/u)).toBeVisible();

      // Set up promise to wait for the tRPC mutation response
      const responsePromise = page.waitForResponse(
        (response) => response.url().includes("trpc/companies.revokeWorkspaceMemberRole") && response.status() === 200,
      );

      // Click the button
      await page.getByRole("button", { name: "Remove lawyer" }).click();

      // Wait for the actual backend response
      await responsePromise;

      // User should be removed from the list since they have no other company relationships
      await expect(page.getByText(lawyerUser.legalName || "")).not.toBeVisible();
    });

    test("allows promoting Member to Admin", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Find contractor (Member) row and click ellipsis menu
      const contractorRow = page.getByRole("row", { name: new RegExp(contractorUser.legalName || "", "u") });
      await expect(contractorRow.locator('[data-slot="badge"]').getByText("Member")).toBeVisible();

      const ellipsisButton = contractorRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();

      // Click "Make Admin" in dropdown
      await page.getByRole("menuitem", { name: "Make Admin" }).click();

      // Wait for role to update
      await expect(contractorRow.locator('[data-slot="badge"]').getByText("Admin")).toBeVisible();
    });

    test("allows promoting Member to Lawyer", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Find investor (Member) row and click ellipsis menu
      const investorRow = page.getByRole("row", { name: new RegExp(investorUser.legalName || "", "u") });
      await expect(investorRow.locator('[data-slot="badge"]').getByText("Member")).toBeVisible();

      const ellipsisButton = investorRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();

      // Click "Make Lawyer" in dropdown
      await page.getByRole("menuitem", { name: "Make Lawyer" }).click();

      // Wait for role to update
      await expect(investorRow.locator('[data-slot="badge"]').getByText("Lawyer")).toBeVisible();
    });

    test("does not show revoke role option for Members", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Find contractor row (Member role) and click ellipsis menu
      const contractorRow = page.getByRole("row", { name: new RegExp(contractorUser.legalName || "", "u") });
      const ellipsisButton = contractorRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();

      // Should see promotion options but not revoke
      await expect(page.getByRole("menuitem", { name: "Make Admin" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Make Lawyer" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Revoke Role" })).not.toBeVisible();
    });

    test("prevents removing last administrator", async ({ page }) => {
      // Remove all admins except primary admin and second admin
      await db
        .delete(companyAdministrators)
        .where(
          and(eq(companyAdministrators.companyId, company.id), eq(companyAdministrators.userId, multiRoleUser.id)),
        );

      await login(page, secondAdmin);
      await page.goto("/settings/administrator/members");

      // Primary admin (owner) should not have action button
      const ownerRow = page.getByRole("row", { name: new RegExp(primaryAdmin.legalName || "", "u") });
      await expect(ownerRow.getByRole("button", { name: "Open menu" })).not.toBeVisible();

      // Second admin should have disabled button when they would be removing the last non-owner admin
      const secondAdminRow = page.getByRole("row", { name: new RegExp(secondAdmin.legalName || "", "u") });
      const ellipsisButton = secondAdminRow.getByRole("button", { name: "Open menu" });
      await expect(ellipsisButton).toBeDisabled();
    });

    test("prevents removing own role", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Owner role should not have any action button
      const ownRow = page.getByRole("row", { name: new RegExp(primaryAdmin.legalName || "", "u") });
      await expect(ownRow.getByRole("button", { name: "Open menu" })).not.toBeVisible();
    });

    test("shows multi-role users with highest role", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      const multiRoleRow = page.getByRole("row", { name: new RegExp(multiRoleUser.legalName || "", "u") });
      await expect(multiRoleRow.locator('[data-slot="badge"]').getByText("Admin")).toBeVisible();
    });

    test("shows no revoke option for Members", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      // Find contractor (Member) row and click ellipsis menu
      const contractorRow = page.getByRole("row", { name: new RegExp(contractorUser.legalName || "", "u") });
      const ellipsisButton = contractorRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();

      // Should see promotion options but no revoke option
      await expect(page.getByRole("menuitem", { name: "Make Admin" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Make Lawyer" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Revoke Role" })).not.toBeVisible();
    });

    test("updates multi-role user to Member when admin/lawyer role is revoked", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      const multiRoleRow = page.getByRole("row", { name: new RegExp(multiRoleUser.legalName || "", "u") });
      await expect(multiRoleRow.locator('[data-slot="badge"]').getByText("Admin")).toBeVisible();

      // Revoke admin role (this removes both admin and lawyer roles per the implementation)
      // so no need to test separately for Lawyer
      const ellipsisButton = multiRoleRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();
      await page.getByRole("menuitem", { name: "Revoke Role" }).click();

      // Set up promise to wait for the tRPC mutation response
      const responsePromise = page.waitForResponse(
        (response) => response.url().includes("trpc/companies.revokeWorkspaceMemberRole") && response.status() === 200,
      );

      await page.getByRole("button", { name: "Remove admin" }).click();

      // Wait for the actual backend response
      await responsePromise;

      await expect(page.getByText(multiRoleUser.legalName || "")).toBeVisible();
      const updatedMultiRoleRow = page.getByRole("row", { name: new RegExp(multiRoleUser.legalName || "", "u") });
      await expect(updatedMultiRoleRow.locator('[data-slot="badge"]').getByText("Member")).toBeVisible();
    });
  });

  test.describe("Role Badge Display", () => {
    test("displays role badges with proper styling and variants", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      await page.waitForLoadState("networkidle");
      await page.waitForSelector("table", { timeout: 10000 });

      const ownerRow = page.getByRole("row", { name: new RegExp(primaryAdmin.legalName || "", "u") });
      const ownerBadge = ownerRow.locator('[data-slot="badge"]').getByText("Owner");
      await expect(ownerBadge).toBeVisible();
      await expect(ownerBadge).toHaveClass(/bg-primary/u);

      const multiRoleRow = page.getByRole("row", { name: new RegExp(multiRoleUser.legalName || "", "u") });
      const adminBadge = multiRoleRow.locator('[data-slot="badge"]').getByText("Admin");
      await expect(adminBadge).toBeVisible();
      await expect(adminBadge).toHaveClass(/border/u);

      const lawyerRow = page.getByRole("row", { name: new RegExp(lawyerUser.legalName || "", "u") });
      const lawyerBadge = lawyerRow.locator('[data-slot="badge"]').getByText("Lawyer");
      await expect(lawyerBadge).toBeVisible();
      await expect(lawyerBadge).toHaveClass(/border/u);

      const contractorRow = page.getByRole("row", { name: new RegExp(contractorUser.legalName || "", "u") });
      const memberBadge = contractorRow.locator('[data-slot="badge"]').getByText("Member");
      await expect(memberBadge).toBeVisible();
      await expect(memberBadge).toHaveClass(/bg-secondary/u);
    });

    test("validates that Members can be promoted to Admin or Lawyer", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      const contractorRow = page.getByRole("row", { name: new RegExp(contractorUser.legalName || "", "u") });
      await expect(contractorRow.locator('[data-slot="badge"]').getByText("Member")).toBeVisible();

      const ellipsisButton = contractorRow.getByRole("button", { name: "Open menu" });
      await ellipsisButton.click();

      await expect(page.getByRole("menuitem", { name: "Make Admin" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Make Lawyer" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Revoke Role" })).not.toBeVisible();

      await page.keyboard.press("Escape");

      const investorRow = page.getByRole("row", { name: new RegExp(investorUser.legalName || "", "u") });

      await expect(investorRow.locator('[data-slot="badge"]').getByText("Member")).toBeVisible();

      const investorEllipsisButton = investorRow.getByRole("button", { name: "Open menu" });
      await investorEllipsisButton.click();

      await expect(page.getByRole("menuitem", { name: "Make Admin" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Make Lawyer" })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Revoke Role" })).not.toBeVisible();
    });
  });

  test.describe("Search", () => {
    test("allows searching by name or email", async ({ page }) => {
      await login(page, primaryAdmin);
      await page.goto("/settings/administrator/members");

      const searchInput = page.getByPlaceholder("Search by name or email...");
      await expect(searchInput).toBeVisible();

      await searchInput.fill(secondAdmin.legalName || "");

      // Should show only matching user
      await expect(page.getByText(secondAdmin.legalName || "")).toBeVisible();
      await expect(page.getByText(lawyerUser.legalName || "")).not.toBeVisible();

      // Clear search
      await searchInput.fill("");

      // All users should be visible again
      await expect(page.getByText(secondAdmin.legalName || "")).toBeVisible();
      await expect(page.getByText(lawyerUser.legalName || "")).toBeVisible();
    });
  });
});
