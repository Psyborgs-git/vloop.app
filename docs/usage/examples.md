# Usage Examples

Here are some practical scenarios for using vloop to automate tasks and orchestrate workflows.

## 1. Local Development Environment

Spin up a complete dev stack (database + backend) using containers and processes.

```bash
# 1. Start a Postgres container
orch container run \
  --name "dev-db" \
  --image "postgres:15" \
  --env "POSTGRES_PASSWORD=secret" \
  --port "5432:5432"

# 2. Start the backend API server
orch process spawn \
  --id "backend-api" \
  --cmd "npm run dev" \
  --cwd "./my-project" \
  --env "DATABASE_URL=postgres://postgres:secret@localhost:5432/postgres"

# 3. Monitor logs
orch process logs backend-api -f
```

## 2. Automated Daily Reporting

Use the scheduler and an AI agent to generate a report.

**Task**: "Every morning at 9 AM, query the sales database, summarize the results, and save it to a file."

1.  **Register the DB**:
    ```bash
    orch db ext register --label "sales-db" ...
    ```

2.  **Create the Agent**:
    ```bash
    orch agent create \
      --name "reporter" \
      --model "gpt-4" \
      --tools "database_query,file_write" \
      --system-prompt "You analyze sales data. Query table 'sales_yesterday', summarize revenue, and write to 'report.md'."
    ```

3.  **Schedule the Job**:
    ```bash
    orch schedule create \
      --id "daily-sales-report" \
      --cron "0 9 * * *" \
      --cmd "orch agent run 'Generate daily sales report'"
    ```

## 3. Secure Production Access

Grant a developer temporary, audited access to a production database.

1.  **Admin configures access**:
    Admin adds the user to a role with `db:ext:query:prod-db` permission but *not* `vault:read:*`.

2.  **Developer connects**:
    ```bash
    orch auth login ...
    orch db query --db "prod-db" --query "SELECT count(*) FROM users"
    ```

3.  **Audit**:
    The admin can review the audit logs to see exactly what queries were run and when.
