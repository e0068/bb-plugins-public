# Task attachment HTTP surface

Attachment upload uses a raw request body at
`POST /api/v1/plugins/tasks/http/attachments/upload`. Raw bytes are the
simplest supported format, but local-auth non-GET plugin routes require JSON,
so upload uses plugin-token auth. Pass the token in `x-bb-plugin-token` (or the
`token` query parameter).

Upload metadata may use query parameters (`taskId` or `commentId`, `fileName`,
and `mime`) or the corresponding `x-task-id`, `x-comment-id`, `x-file-name`,
and `x-mime-type` headers. Exactly one owner is required. The response is
`{ attachmentId, url }`.

The returned local-auth frontend URL is
`GET /api/v1/plugins/tasks/http/attachments/download?attachmentId=...`.
Upload and download also take an optional `callerThreadId` query parameter:
the route then looks the task up in that thread's worktree, so a task that so
far lives only on the thread's branch still accepts and serves its files. A
thread surface appends it when it renders an image; the stored markdown keeps
the plain URL (`shared/attachment-url.ts`).
Deletion is
`DELETE /api/v1/plugins/tasks/http/attachments/delete?attachmentId=...` and,
because it is a local-auth non-GET request, must use `Content-Type:
application/json`.
