# Shopify → HubSpot Commercial Wrap Intake

Status: staging only. No production routes or existing Printavo processes are modified.

## Intended flow
1. Shopify customer-facing form collects company, contact name, email, phone, vehicle type, count, coverage, artwork status, timeline and notes.
2. Dedicated server-side endpoint validates required fields, enforces spam/rate protections and checks allowed origin.
3. Server uses a private HubSpot API credential (never embedded in Shopify HTML) to upsert the contact, then create and associate a deal in pipeline `default`, stage `4494748354`, service_category `vehicle_wraps`.
4. Send confirmation to the customer's submitted email from info@creativecoatingskc.com through an authenticated transactional email provider; notify the shop separately.
5. Return a confirmation reference; prevent duplicate submissions and retry transient failures safely.

## Deployment guardrails
- Existing Render production service runs an MCP employee intake. Do not change its existing endpoints or SMTP behavior.
- Implement and test on a separate preview service or isolated branch before production.
- Shopify page 162369896542 remains unpublished.
- No customer messages should be sent during testing. Use an explicitly authorized test address.
- HubSpot connector permission does not provide an API token to the Render runtime. A separate private credential and authorization setup is required.
- Configure email sender authentication and ensure customer-facing privacy notice and consent text are appropriate.
- After successful end-to-end testing, connect the Shopify page and publish only with owner approval.
