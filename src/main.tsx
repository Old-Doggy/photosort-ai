/* oxlint-disable react/only-export-components -- entry file renders routes, it is not a Fast Refresh component module */
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import FolderControl from './FolderControl.tsx'

const App = lazy(() => import('./App.tsx'))
const ReviewPanel = lazy(() => import('./ReviewPanel.tsx'))
const params = new URLSearchParams(location.search)
const page = params.get('legacy') === '1' ? 'legacy' : params.get('review') === '1' ? 'review' : 'folder'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="app-loading" role="status">正在加载…</div>}>
      {page === 'legacy' ? <App /> : page === 'review' ? <ReviewPanel /> : <FolderControl />}
    </Suspense>
  </StrictMode>,
)
