import type { Metadata } from "next";
import { LegalShell } from "../LegalShell";

export const metadata: Metadata = {
  title: "DPDP & Data Rights — GroundTruth AI",
  description:
    "How GroundTruth AI handles personal data under India's Digital Personal Data Protection Act, 2023.",
};

export default function DpdpPage() {
  return (
    <LegalShell
      eyebrow="Legal · India"
      title="DPDP & Data Rights"
      updated="Last updated: 18 November 2026"
      current="/dpdp"
    >
      <p>
        GroundTruth AI is built in India, for users in India, and handles
        personal data under the Digital Personal Data Protection Act, 2023
        (DPDP Act). This page explains, in plain language, what that means
        for you as a Data Principal (the person the data is about).
      </p>

      <h2>1. What we collect and why</h2>
      <p>
        We collect only what the platform needs to work: your name and email
        to run your account; your education, skills, projects and resumes to
        build your verified profile; your applications, messages and
        assessment results to connect you with recruiters and evidence your
        skills. We do not collect data unrelated to these purposes, and we do
        not track you across other websites.
      </p>

      <h2>2. Consent</h2>
      <p>
        Creating an account and filling in your profile is consent to process
        that data for the purposes described here and in the Privacy Policy.
        Some processing needs a separate, explicit consent:
      </p>
      <ul>
        <li>
          <strong>Assessment monitoring:</strong> when you start a coding
          assessment or AI interview, you consent to the platform recording
          code snapshots, test runs, terminal commands and related activity
          events for that assessment. You can decline by not starting the
          assessment.
        </li>
        <li>
          <strong>Linked profiles:</strong> linking a GitHub or coding-platform
          profile consents to the platform reading the public evidence on it.
        </li>
      </ul>
      <p>
        You may withdraw consent at any time (see section 4). Withdrawing
        consent for data the service cannot run without — for example, your
        account email — means we will close the account instead.
      </p>

      <h2>3. Your rights as a Data Principal</h2>
      <p>Under the DPDP Act you have the right to:</p>
      <ul>
        <li>
          <strong>Know</strong> what personal data we hold about you and how
          we process it — ask us through the contact form and we will tell
          you.
        </li>
        <li>
          <strong>Correct and complete</strong> your data, and <strong>update
          </strong> it when it changes — most of it is editable in your
          profile; the rest we will correct on request.
        </li>
        <li>
          <strong>Erase</strong> your personal data, subject to legal
          retention (for example, records we must keep to show an assessment
          result was genuine). Monitoring events are deleted automatically 90
          days after the assessment ends.
        </li>
        <li>
          <strong>Grievance redressal:</strong> raise a complaint with us
          first — see section 5. If it is not resolved, you may approach the
          Data Protection Board of India.
        </li>
        <li>
          <strong>Nominate</strong> another person to exercise these rights
          for you if you are unable to do so.
        </li>
      </ul>

      <h2>4. How to exercise your rights</h2>
      <p>
        Send a request through the <a href="/contact">contact form</a>{" "}
        stating your registered email and what you want (access, correction,
        erasure or consent withdrawal). We will verify that the request comes
        from the account holder and respond as soon as reasonably possible.
      </p>

      <h2>5. Grievance Officer</h2>
      <p>
        Until a dedicated grievance email is published, grievances under the
        DPDP Act can be raised through the{" "}
        <a href="/contact">contact form</a> with the subject &ldquo;DPDP
        grievance&rdquo;. We acknowledge receipt and aim to resolve grievances
        within the timelines the DPDP Rules require.
      </p>

      <h2>6. Children&apos;s data</h2>
      <p>
        GroundTruth AI is intended for adults and students aged 18 and over.
        We do not knowingly collect personal data from children, and we do
        not track or behaviourally monitor children.
      </p>

      <h2>7. Data security and breaches</h2>
      <p>
        We protect personal data with hashed passwords, per-request access
        checks on applications, messages and assessments, and least-privilege
        access for our own systems. If a personal data breach occurs, we will
        notify affected users and the Data Protection Board of India as the
        DPDP Act requires.
      </p>
    </LegalShell>
  );
}
