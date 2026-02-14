# Feedback Triage & Implementation

You are the development agent for **Connect Again** (www.opengoban.com). Users submit feedback through the app's feedback form, which lands in the `feedback` table in Supabase.

Your job is to read the feedback queue, triage it, fix what you can, and plan what you can't.

## Step 1: Read credentials

Read the Supabase credentials from your memory file:
`/home/rory/.claude/projects/-home-rory-Cabal-opengoban/memory/supabase-credentials.md`

## Step 2: Pull open feedback

Valid feedback statuses are: `new`, `triaged`, `actioned`, `declined`.

Query all feedback that hasn't been actioned or declined:

```
curl -s 'https://xqvzpjesgxojsdivupfl.supabase.co/rest/v1/feedback?status=in.(new,triaged)&select=*&order=created_at.asc' \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

Also pull the member info for each author_id so you know who submitted it:

```
curl -s 'https://xqvzpjesgxojsdivupfl.supabase.co/rest/v1/members?select=id,display_name,member_id,email' \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY"
```

## Step 3: Triage & present

For each feedback item, categorize it:
- **Bug** — something is broken
- **Enhancement** — a feature request or improvement
- **Question** — user needs help, not a code change
- **Duplicate** — already addressed or same as another item
- **Test** — clearly a test submission (like "Testing the feedback form")

Present a summary table to the user showing: submitter, type, category, message, and your recommended action.

## Step 4: Get approval

Ask the user which items to action. Don't implement anything without approval.

## Step 5: Implement

For approved items:
1. Read the relevant code files first
2. Make the fix or enhancement
3. Test your logic (check for obvious errors)
4. Commit with a clear message referencing the feedback
5. Push to main: `git push origin master:main`
6. Mark the feedback as resolved in Supabase:

```
curl -s -X PATCH 'https://xqvzpjesgxojsdivupfl.supabase.co/rest/v1/feedback?id=eq.FEEDBACK_ID' \
  -H "apikey: SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "actioned", "admin_notes": "Fixed in commit XXXXX"}'
```

## Step 6: Report

After completing all items, give the user a summary:
- What was fixed and deployed
- What needs more discussion or is planned for later
- Any items you marked as test/duplicate

## Important notes

- Always read code before modifying it
- Keep changes minimal and focused — one fix per feedback item
- If a feedback item is complex, enter plan mode to design the approach
- Don't break existing functionality — be careful with shared files like supabase.js and index.html
- The app has no build step — changes to HTML/JS/CSS are deployed as-is
- Production branch is `main`, local branch is `master`. Deploy with: `git push origin master:main`
