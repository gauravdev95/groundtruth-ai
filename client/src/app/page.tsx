import Link from "next/link";

const STEPS = [
  {
    title: "1. Verify",
    text: "Skills are checked against real evidence — GitHub activity, coding platforms, and certificates.",
  },
  {
    title: "2. Interview",
    text: "Code-grounded interviews confirm the candidate can actually do the work they claim.",
  },
  {
    title: "3. Match",
    text: "Candidates and jobs are matched two-way on embeddings, so both sides see a real fit.",
  },
];

export default function HomePage() {
  return (
    <main className="container">
      <section className="hero">
        <h1>Hire on proof, not promises.</h1>
        <p>
          Ground Truth AI verifies what candidates can actually do — then
          matches them to the jobs where the evidence fits.
        </p>
        <Link className="cta" href="/jobs">
          Browse open roles
        </Link>
      </section>
      <section className="steps" aria-label="How it works">
        {STEPS.map((step) => (
          <article className="step" key={step.title}>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
