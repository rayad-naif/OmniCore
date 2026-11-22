import { useEffect } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';

export default function AnimatedNumber({ value, className = '' }) {
  if (value === '--' || value === null || value === undefined) {
    return <span className={className}>{value ?? '--'}</span>;
  }

  const str = String(value);
  const prefix = str.match(/^[^\d]*/)?.[0] ?? '';
  const suffix = str.match(/[^\d]*$/)?.[0]?.replace(/^[\d,.]+/, '') ?? '';
  const numeric = parseFloat(str.replace(/[^0-9.]/g, ''));

  if (Number.isNaN(numeric)) {
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

  const spring = useSpring(0, { stiffness: 80, damping: 20 });
  const display = useTransform(spring, (v) => {
    const rounded = Math.round(v);
    return `${prefix}${rounded.toLocaleString()}${suffix}`;
  });

  useEffect(() => {
    spring.set(numeric);
  }, [numeric, spring]);

  return <motion.span className={className}>{display}</motion.span>;
}