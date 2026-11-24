import type { Metadata } from "next";
import { LegalShell } from "../LegalShell";

export const metadata: Metadata = {
  title: "Terms of Service — GroundTruth AI",
  description:
    "Terms of Service for GroundTruth AI, the AI-verified talent marketplace.",
};

export default function TermsPage() {
  return (
    <LegalShell
      eyebrow="Legal"
      title="Terms of Service"
      updated="Last updated: 18 November 2026"
      current="/terms"
    >
      <p>
        These terms govern your use of GroundTruth AI, an AI-verified talent
        marketplace that connects students and job seekers (&ldquo;candidates&rdquo;)
        with employers (&ldquo;recruiters&rdquo;). By creating an account or using
        the platform, you agree to these terms.
      </p>

      <h2>1. What GroundTruth AI does</h2>
      <p>
        GroundTruth AI verifies candidate skills against real evidence —
        GitHub repositories, coding-platform profiles, certificates, and
        code-grounded assessments and AI interviews — and shows recruiters
        that evidence alongside applications. Match scores are cosine
        similarities between stored embeddings; a missing score is shown as
        &ldquo;no match score yet&rdquo;, never invented.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>
          You are responsible for keeping your sign-in credentials private and
          for everything done under your account.
        </li>
        <li>
          The information on your profile must be yours and truthful. Listing
          work, credentials or achievements that are not yours is a violation
          of these terms and may lead to account suspension.
        </li>
        <li>
          Recruiters may only post genuine roles for their own company and may
          only view applications for roles under their company.
        </li>
      </ul>

      <h2>3. Verified evidence, not guarantees</h2>
      <p>
        A &ldquo;verified&rdquo; skill means the platform found evidence for it in
        an assessment, repository analysis or other checked source. It is not
        a guarantee of future job performance, and it does not mean GroundTruth
        AI endorses any candidate or employer. Hiring decisions are made by
        recruiters; AI scores and reports are advisory.
      </p>

      <h2>4. Assessments and monitoring consent</h2>
      <p>
        Coding assessments and AI interviews on this platform are monitored to
        keep results honest: the platform records code snapshots, test runs,
        terminal commands and related activity events while an assessment is
        active. Starting an assessment means you consent to that monitoring
        for that assessment. Monitoring events are retained for 90 days and
        then deleted (see the Privacy Policy).
      </p>

      <h2>5. Acceptable use</h2>
      <ul>
        <li>Do not upload malware, or attempt to access other users&apos; data.</li>
        <li>
          Do not use the platform to scrape, spam or harass other users, and
          do not use automated tools to game assessments or match scores.
        </li>
        <li>
          Messages between candidates and recruiters must relate to a real
          application on the platform.
        </li>
      </ul>

      <h2>6. Content you provide</h2>
      <p>
        You keep ownership of your resumes, code, project descriptions and
        messages. You grant GroundTruth AI a licence to store and display
        them to the other party of your applications and assessments, as the
        platform requires to work. We do not sell your content.
      </p>

      <h2>7. Availability and liability</h2>
      <p>
        The platform is provided &ldquo;as is&rdquo; without warranties of
        uninterrupted availability. To the maximum extent permitted by law,
        GroundTruth AI is not liable for hiring outcomes, lost opportunities
        or indirect damages arising from use of the platform.
      </p>

      <h2>8. Changes and contact</h2>
      <p>
        We may update these terms and will show the new &ldquo;last updated&rdquo;
        date on this page. Continued use after an update means you accept the
        new terms. Questions about these terms can be sent through the{" "}
        <a href="/contact">contact form</a>.
      </p>
    </LegalShell>
  );
}
