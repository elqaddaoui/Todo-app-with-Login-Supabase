import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './index.css'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css'
const qc=new QueryClient({defaultOptions:{queries:{staleTime:300000,refetchOnWindowFocus:false}}})
ReactDOM.createRoot(document.getElementById('root')!).render(
<React.StrictMode><QueryClientProvider client={qc}><BrowserRouter><App/></BrowserRouter></QueryClientProvider></React.StrictMode>)
