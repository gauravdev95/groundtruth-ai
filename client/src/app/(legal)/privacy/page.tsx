import type { Metadata } from "next";
import { LegalShell } from "../LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy — GroundTruth AI",
  description:
    "Privacy Policy for GroundTruth AI: what data we collect, why, and how long we keep it.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      eyebrow="Legal"
      title="Privacy Policy"
      updated="Last updated: 18 November 2026"
      current="/privacy"
    >
      <p>
        GroundTruth AI collects only the data the platform needs to verify
        skills, run assessments and connect candidates with recruiters. We do
        not sell personal data, and we do not show advertising based on your
        profile.
      </p>

      <h2>1. Data we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> name, email address, password hash
          and role (candidate, recruiter or admin).
        </li>
        <li>
          <strong>Profile data you provide:</strong> education, skills,
          projects, resumes, certificates and coding-platform profiles you
          choose to link.
        </li>
        <li>
          <strong>Application data:</strong> jobs you apply to, application
          status history, and messages you send to the other party of an
          application.
        </li>
        <li>
          <strong>Assessment data:</strong> repository analyses, challenge
          submissions, code snapshots, test results, interview answers and
          scores, and monitoring events recorded while an assessment is
          active (code snapshots, test runs, terminal commands).
        </li>
        <li>
          <strong>Contact data:</strong> name, email and message text from
          the contact form.
        </li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>To run the service: accounts, applications, messaging and notifications.</li>
        <li>
          To verify skills: comparing your linked repositories, profiles and
          assessment results against the skills you claim.
        </li>
        <li>
          To match candidates and jobs: computing similarity scores from
          stored embeddings of candidate and job text.
        </li>
        <li>
          To keep assessments honest: monitoring events are reviewed only in
          connection with the assessment they belong to.
        </li>
      </ul>

      <h2>3. Who sees your data</h2>
      <ul>
        <li>
          Recruiters see your profile and evidence only when you apply to one
          of their company&apos;s roles — and only recruiters of that company.
        </li>
        <li>Other candidates never see your applications, messages or assessment data.</li>
        <li>
          We do not share your data with advertisers or data brokers. Service
          providers that store or process data for us (hosting, file storage)
          do so only as instructed by us.
        </li>
      </ul>

      <h2>4. Retention</h2>
      <ul>
        <li>
          <strong>Monitoring events:</strong> retained for 90 days after the
          assessment ends, then deleted.
        </li>
        <li>
          <strong>Account, profile, application and message data:</strong>{" "}
          kept while your account is active. You can ask for deletion (see
          section 5).
        </li>
        <li>
          <strong>Contact-form messages:</strong> kept until handled, then
          deleted on request.
        </li>
      </ul>

      <h2>5. Your rights</h2>
      <p>
        You can ask us to access, correct or delete your personal data, and
        to withdraw consent where processing relies on it. Use the{" "}
        <a href="/contact">contact form</a> to make a request, or the account
        settings in the product where available. India users have additional
        rights under the DPDP Act — see the{" "}
        <a href="/dpdp">DPDP &amp; Data Rights</a> page.
      </p>

      <h2>6. Security</h2>
      <p>
        Passwords are stored as hashes, never in plain text. Access to
        applications, messages and assessment data is checked on every
        request, so one user cannot read another user&apos;s records. No
        system is perfect — if you believe your account is compromised, change
        your password and contact us immediately.
      </p>

      <h2>7. Changes</h2>
      <p>
        We will update the &ldquo;last updated&rdquo; date on this page when this
        policy changes. Material changes will be highlighted in the product.
      </p>
    </LegalShell>
  );
}
