export const spring = {
  snappy:  { type: 'spring', stiffness: 380, damping: 28 },
  smooth:  { type: 'spring', stiffness: 260, damping: 24 },
  gentle:  { type: 'spring', stiffness: 180, damping: 22 },
};

export const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { ...spring.smooth, delay: i * 0.06 },
  }),
};

export const fadeDown = {
  hidden: { opacity: 0, y: -12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: spring.smooth,
  },
};

export const staggerContainer = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

export const staggerItem = {
  hidden: { opacity: 0, x: -12 },
  visible: {
    opacity: 1,
    x: 0,
    transition: spring.smooth,
  },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: spring.snappy,
  },
};

export const dropdown = {
  hidden:  { opacity: 0, y: 8, scale: 0.95 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18 } },
  exit:    { opacity: 0, y: 8, scale: 0.95, transition: { duration: 0.12 } },
};

export const cardHover = {
  rest:  { scale: 1, y: 0 },
  hover: { scale: 1.02, y: -3, transition: spring.snappy },
  tap:   { scale: 0.98 },
};