import Image from "next/image";
import { Promo } from "./Promo";
import hero from "../public/hero.jpg";

export default function Page() {
  return (
    <main>
      <header>Corner Bakery</header>
      <Promo />
      <h1>Small-batch sourdough, baked at dawn</h1>
      {/* Fixes 1 + 2a: next/image serves AVIF/WebP at the viewport's width,
          preload + fetchPriority="high" make the browser fetch it first, and the static
          import gives it width/height so space is reserved. */}
      <div className="hero">
        <Image src={hero} alt="Loaves cooling on a rack" preload fetchPriority="high" sizes="100vw" />
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
