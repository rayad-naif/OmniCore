import { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

function parse(value) {
  if (value === '--' || value === null || value === undefined) return null;
  const str = String(value);
  const numeric = parseFloat(str.replace(/[^0-9.]/g, ''));
  if (Number.isNaN(numeric)) return null;
  return {
    numeric,
    prefix: str.match(/^[^\d]*/)?.[0] ?? '',
    suffix: str.match(/[^\d]*$/)?.[0]?.replace(/^[\d,.]+/, '') ?? '',
  };
}

// Hooks are always called in the same order (the original returned early
// before calling them, which breaks React when a value changes type).
export default function AnimatedNumber({ value, className = '' }) {
  const parsed = parse(value);
  const spring = useSpring(0, { stiffness: 80, damping: 20 });
  const display = useTransform(spring, (v) => {
    const rounded = Math.round(v);
    return `${parsed?.prefix ?? ''}${rounded.toLocaleString()}${parsed?.suffix ?? ''}`;
  });

  useEffect(() => {
    if (parsed) spring.set(parsed.numeric);
  }, [parsed?.numeric, spring]);  

  if (value === '--' || value === null || value === undefined) {
    return <span className={className}>{value ?? '--'}</span>;
  }
  if (!parsed) {
    return (
      <motion.span
        className={className}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        {value}
      </motion.span>
    );
  }
  return <motion.span className={className}>{display}</motion.span>;
}
