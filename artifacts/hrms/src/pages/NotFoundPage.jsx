import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, Home } from 'lucide-react';

export default function NotFoundPage() {
  return (
    <div className="min-h-screen bg-surface-950 bg-mesh flex-center flex-col gap-6 text-center p-6">
      <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}>
        <div className="w-16 h-16 rounded-2xl bg-primary-600 flex-center mx-auto mb-6 shadow-glow-primary">
          <Zap className="w-8 h-8 text-white"/>
        </div>
        <p className="text-8xl font-display font-bold text-gradient mb-2">404</p>
        <h1 className="text-2xl font-display font-bold text-white mb-2">Page Not Found</h1>
        <p className="text-slate-400 text-sm mb-8 max-w-sm">The page you're looking for doesn't exist or has been moved.</p>
        <Link to="/login" className="btn-primary inline-flex">
          <Home className="w-4 h-4"/>Go to Dashboard
        </Link>
      </motion.div>
    </div>
  );
}
