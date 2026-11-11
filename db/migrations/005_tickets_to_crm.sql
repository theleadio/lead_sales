-- lead_sales migration 005: the tickets and the inbox move to lead_crm
-- (decided 11 Nov: tickets and enquiries live in the CRM only).
--
-- lead_crm's migration 019 creates their CRM versions in the shared database
-- (team, team_member, enquiry_category, enquiry_rule, holiday, conversation,
-- conversation_message, enquiry_event, and new enquiry columns). Apply that
-- first: the automations below read those tables from now on.
--
-- This drops lead_sales' copies from migration 003, WITH THEIR ROWS. Nothing
-- is copied across: the tables were only on staging (decided 11 Nov). Export
-- anything worth keeping before applying this.
--
-- Automations: the TicketCreated trigger becomes EnquiryCreated (reading
-- lead_crm `enquiry`), and its old cursor goes. The new cursor starts at the
-- moment it is first read, so no old enquiry fires an automation. A condition
-- on event.category = 'general' needs changing to 'other' by hand: the CRM's
-- fallback category is `other`.

UPDATE sales.automation SET trigger = 'EnquiryCreated' WHERE trigger = 'TicketCreated';
DELETE FROM sales.automation_cursor WHERE name = 'ticket';

DROP TABLE IF EXISTS sales.ticket_event;
DROP FUNCTION IF EXISTS sales.ticket_event_append_only();
DROP TABLE IF EXISTS sales.ticket;
DROP SEQUENCE IF EXISTS sales.ticket_number_seq;
DROP TABLE IF EXISTS sales.message;
DROP TABLE IF EXISTS sales.conversation;
DROP TABLE IF EXISTS sales.ticket_rule;
DROP TABLE IF EXISTS sales.ticket_category;
DROP TABLE IF EXISTS sales.team_member;
DROP TABLE IF EXISTS sales.team;
DROP TABLE IF EXISTS sales.holiday;
