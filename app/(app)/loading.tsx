// What shows while a screen loads: grey shapes in the layout of a typical
// screen (title, tiles, table rows), so a slow page never looks frozen.
export default function Loading() {
  return (
    <section className="max-w-5xl" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-7 w-56" />
      <div className="skeleton mt-3 h-4 w-80 max-w-full" />
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24 rounded-2xl" />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="skeleton h-11" />
        ))}
      </div>
    </section>
  );
}
