<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`, `trigger-getting-started`, `trigger-realtime-and-frontend`, `trigger-authoring-chat-agent`.
<!-- TRIGGER.DEV SKILLS END -->

## Railway environment sync

Always exclude `TRIGGER_SECRET_KEY` when syncing local environment variables to Railway, including bulk syncs. The local key is for Trigger.dev development. Leave Railway's existing `TRIGGER_SECRET_KEY` untouched.
