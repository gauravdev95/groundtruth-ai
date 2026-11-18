"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare, Send } from "lucide-react";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { StudentShell, StudentPageHead } from "@/components/student/StudentShell";
import {
  RecruiterShell,
  RecruiterPageHead,
} from "@/components/recruiter/RecruiterShell";
import { useAuth } from "@/lib/auth-context";
import {
  ApiHttpError,
  fetchThread,
  fetchMessageThreads,
  sendThreadMessage,
  type MessageThread,
  type ThreadDetail,
} from "@/lib/api";

/**
 * Phase 7 messaging UI, shared by the student and recruiter routes.
 * Threads are per application; the server enforces that only the two
 * parties can read or write — the UI only renders what the API returns.
 */

type Role = "candidate" | "recruiter";

function Shell({
  role,
  children,
}: {
  role: Role;
  children: ReactNode;
}) {
  return role === "candidate" ? (
    <StudentShell>{children}</StudentShell>
  ) : (
    <RecruiterShell>{children}</RecruiterShell>
  );
}

function PageHead({
  role,
  eyebrow,
  title,
  sub,
  actions,
}: {
  role: Role;
  eyebrow: string;
  title: ReactNode;
  sub?: string;
  actions?: ReactNode;
}) {
  return role === "candidate" ? (
    <StudentPageHead eyebrow={eyebrow} title={title} sub={sub} actions={actions} />
  ) : (
    <RecruiterPageHead eyebrow={eyebrow} title={title} sub={sub} actions={actions} />
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ThreadListContent({ role }: { role: Role }) {
  const base = role === "candidate" ? "/student/messages" : "/recruiter/messages";
  const [threads, setThreads] = useState<MessageThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMessageThreads()
      .then(setThreads)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Could not load messages."),
      );
  }, []);

  if (error || threads === null) {
    if (error) {
      return (
        <div className="st-empty">
          <h2>Couldn&apos;t load messages</h2>
          <p>{error}</p>
          <button
            type="button"
            className="st-btn st-btn-blue"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      );
    }
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading your messages…</p>
      </div>
    );
  }

  return (
    <>
      <PageHead
        role={role}
        eyebrow="Messages"
        title={
          <>
            Your <span className="blue">conversations.</span>
          </>
        }
        sub="One thread per application — only you and the other party can read it."
      />
      {threads.length === 0 ? (
        <div className="st-empty">
          <MessageSquare size={28} aria-hidden="true" />
          <h2>No messages yet</h2>
          <p>
            When you apply to a role, you can message the recruiter here — and
            recruiters can message you about your application.
          </p>
        </div>
      ) : (
        <div className="st-thread-list">
          {threads.map((t) => (
            <div key={t.application_id} className="st-panel">
              <Link
                href={`${base}/${t.application_id}`}
                className="st-thread-item"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ fontSize: 15.5, fontWeight: 800 }}>
                    {t.job_title}
                    {t.company_name ? ` — ${t.company_name}` : ""}
                  </h3>
                  <p className="st-list-meta">
                    {role === "candidate"
                      ? `Application: ${t.application_status}`
                      : `${t.candidate_name} · ${t.application_status}`}
                    {t.last_message_at ? ` · ${fmtDate(t.last_message_at)}` : ""}
                  </p>
                  <p className="st-list-meta" style={{ marginTop: 6 }}>
                    {t.last_message ?? "No messages yet — say hello."}
                  </p>
                </div>
                {t.unread_count > 0 ? (
                  <span className="st-unread-badge" aria-label={`${t.unread_count} unread`}>
                    {t.unread_count}
                  </span>
                ) : null}
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function ThreadContent({
  role,
  applicationId,
}: {
  role: Role;
  applicationId: string;
}) {
  const base = role === "candidate" ? "/student/messages" : "/recruiter/messages";
  const { user } = useAuth();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    fetchThread(applicationId)
      .then(setThread)
      .catch((err) => {
        if (err instanceof ApiHttpError && err.status === 403) {
          setForbidden(true);
        } else {
          setError(err instanceof Error ? err.message : "Could not load this thread.");
        }
      });
  }, [applicationId]);

  async function onSend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const sent = await sendThreadMessage(applicationId, body);
      setThread((t) =>
        t
          ? {
              ...t,
              messages: [
                ...t.messages,
                {
                  ...sent,
                  sender_name: user?.full_name ?? null,
                  sender_role: role,
                },
              ],
            }
          : t,
      );
      setDraft("");
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : "Could not send the message.",
      );
    } finally {
      setSending(false);
    }
  }

  if (forbidden) {
    return (
      <div className="st-empty">
        <h2>This conversation isn&apos;t yours</h2>
        <p>
          Only the candidate who applied and the recruiters for that role can
          read this thread.
        </p>
        <Link href={base} className="st-btn st-btn-blue">
          Back to messages
        </Link>
      </div>
    );
  }

  if (error || thread === null) {
    if (error) {
      return (
        <div className="st-empty">
          <h2>Couldn&apos;t load this thread</h2>
          <p>{error}</p>
          <Link href={base} className="st-btn st-btn-blue">
            Back to messages
          </Link>
        </div>
      );
    }
    return (
      <div className="st-loading" role="status" aria-label="Loading">
        <span className="st-spinner" aria-hidden="true" />
        <p>Loading the conversation…</p>
      </div>
    );
  }

  return (
    <>
      <PageHead
        role={role}
        eyebrow="Messages"
        title={
          <>
            {thread.job_title}
            {thread.company_name ? (
              <>
                {" "}
                <span className="blue">— {thread.company_name}</span>
              </>
            ) : null}
          </>
        }
        sub={`${thread.candidate_name} · Application: ${thread.application_status}`}
        actions={
          <Link href={base} className="st-btn st-btn-outline">
            <ArrowLeft size={16} aria-hidden="true" /> All messages
          </Link>
        }
      />
      <div className="st-panel">
        {thread.messages.length === 0 ? (
          <p className="st-panel-desc">
            No messages yet. Introduce yourself — the other party will be
            notified.
          </p>
        ) : (
          <div className="st-msg-list">
            {thread.messages.map((m) => {
              const mine = user ? m.sender_id === user.id : false;
              return (
                <div
                  key={m.id}
                  className={mine ? "st-msg st-msg-mine" : "st-msg st-msg-theirs"}
                >
                  <div>{m.body}</div>
                  <div className="st-msg-meta">
                    {m.sender_name ?? (mine ? "You" : "Recruiter")} ·{" "}
                    {fmtDate(m.created_at)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <form className="st-msg-form" onSubmit={onSend}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a message…"
            aria-label="Write a message"
            maxLength={5000}
          />
          <button
            type="submit"
            className="st-btn st-btn-blue"
            disabled={sending || draft.trim().length === 0}
          >
            <Send size={16} aria-hidden="true" /> Send
          </button>
        </form>
        {sendError ? (
          <p className="st-panel-desc" style={{ color: "#8c1d1d" }} role="alert">
            {sendError}
          </p>
        ) : null}
      </div>
    </>
  );
}

export function MessagesListPage({ role }: { role: Role }) {
  return (
    <RequireAuth roles={[role]}>
      <Shell role={role}>
        <ThreadListContent role={role} />
      </Shell>
    </RequireAuth>
  );
}

export function MessageThreadPage({
  role,
  applicationId,
}: {
  role: Role;
  applicationId: string;
}) {
  return (
    <RequireAuth roles={[role]}>
      <Shell role={role}>
        <ThreadContent role={role} applicationId={applicationId} />
      </Shell>
    </RequireAuth>
  );
}
