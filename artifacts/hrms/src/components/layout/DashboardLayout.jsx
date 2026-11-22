import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { toggleSidebar, setSidebarOpen } from '@/store/slices/uiSlice';
import Sidebar from './Sidebar';
import Header from './Header';
import AIAssistant from '@/components/common/AIAssistant';

export default function DashboardLayout() {
  const dispatch = useDispatch();
  const { sidebarOpen, sidebarCollapsed } = useSelector((s) => s.ui);

  // Close sidebar on mobile resize
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) dispatch(setSidebarOpen(false));
      else dispatch(setSidebarOpen(true));
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [dispatch]);

  return (
    <div className="flex h-screen bg-white dark:bg-surface-950 overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => dispatch(setSidebarOpen(false))}
        />
      )}

      {/* Main content */}
      <div
        className="flex-1 flex flex-col overflow-hidden transition-all duration-300"
        style={{
          marginLeft: sidebarOpen
            ? sidebarCollapsed ? '72px' : 'var(--sidebar-width, 260px)'
            : '0',
        }}
      >
        <Header />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 bg-mesh">
          <div className="max-w-screen-2xl mx-auto animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Floating AI Assistant */}
      <AIAssistant />
    </div>
  );
}
