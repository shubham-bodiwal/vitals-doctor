"use client";
import { useEffect, useState } from "react";

// Classic mistake 2b: content injected above the fold after load, with no
// reserved space. Everything below it jumps down (CLS).
export function Promo() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 800);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  return <div className="promo">Free delivery this week on orders over $20</div>;
}
