# lib/crm: copies of lead_crm rules

`lead_sales` writes CRM data directly in the shared database (build plan, ground rule 4, decided 4 Nov evening). So it must follow the same rules the CRM follows. These files are **copies** of `lead_crm` code. Each says where it came from.

- **Keep them in step.** When the rule changes in `lead_crm`, change it here too. The weekly check is in the build plan.
- **Rules the database enforces apply to both apps automatically,** so they aren't copied here: seat triggers (migration 006), status history (009) and unique keys.
