import { useEffect } from "react";

const FORM_EMBED_SRC = "https://connect.irofficial.com/js/form_embed.js";
const BOOKING_SRC = "https://connect.irofficial.com/widget/booking/eDGfB6spPBDqgzdQCUjy";

export function BookingCalendar() {
  useEffect(() => {
    if (document.querySelector(`script[src="${FORM_EMBED_SRC}"]`)) return;
    const script = document.createElement("script");
    script.src = FORM_EMBED_SRC;
    script.type = "text/javascript";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  return (
    <iframe
      src={BOOKING_SRC}
      title="Book a setup call with Atelier OmniCore"
      className="w-full border-0 overflow-hidden min-h-[720px] rounded-2xl"
      scrolling="no"
      id="eDGfB6spPBDqgzdQCUjy_booking"
    />
  );
}
