"use client";
import { useEffect, useState } from "react";

export function Promo() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 800);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="promo-slot">
      {show && <div className="promo">Free delivery this week on orders over $20</div>}
    </div>
  );
}
