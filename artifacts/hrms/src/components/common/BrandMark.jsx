import { logoUrl, initials } from '@/services/brand';

// Agency / platform logo, or a monogram when no logo is set.
export default function BrandMark({ className = 'w-9 h-9', textClassName = 'text-sm' }) {
  const url = logoUrl();
  if (url) return <img src={url} alt="" className={`${className} object-contain`} />;
  return (
    <span
      aria-hidden
      className={`${className} ${textClassName} inline-flex items-center justify-center rounded-xl bg-primary-600 font-bold text-white`}
    >
      {initials()}
    </span>
  );
}
