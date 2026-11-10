// A row of numbered steps: the ones before `current` are done.
export default function FlowSteps({ steps, current, label }) {
  return (
    <ol className="flow-steps" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s} className={i < current ? 'done' : i === current ? 'on' : undefined}>{i + 1} · {s}</li>
      ))}
    </ol>
  );
}
