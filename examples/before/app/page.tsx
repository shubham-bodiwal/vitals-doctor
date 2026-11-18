import { Promo } from "./Promo";

export default function Page() {
  return (
    <main>
      <header>Corner Bakery</header>
      <Promo />
      <h1>Small-batch sourdough, baked at dawn</h1>
      {/* Classic mistakes 1 + 2a: a 2400px, 1.5 MB JPEG as the LCP element,
          lazy-loaded (so the browser fetches it late) and with no width/height
          (so it shifts the layout when it arrives). */}
      <div className="hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hero.jpg" alt="Loaves cooling on a rack" loading="lazy" />
      </div>
      <section className="copy">
        <h2>Fresh bread, every morning</h2>
        <p>
          We bake in small batches from 4am so the first loaf out of the oven is
          the one on your table. Sourdough, rye and a rotating seasonal loaf.
        </p>
        <p>
          Order by 9pm for next-morning pickup, or drop by the counter. We keep
          a short list on purpose: fewer things, done properly.
        </p>
      </section>
    </main>
  );
}
