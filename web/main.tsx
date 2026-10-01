import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { PublicJsonRepository } from './repositories/PublicJsonRepository.ts';
import type { OpportunityRepository } from './repositories/OpportunityRepository.ts';
import './style.css';
async function start(){
  let repository:OpportunityRepository=new PublicJsonRepository();
  // Vite removes this branch and local repository from production bundles.
  if(import.meta.env.DEV&&['localhost','127.0.0.1'].includes(location.hostname)){
    const {LocalHttpRepository}=await import('./repositories/LocalHttpRepository.ts');repository=new LocalHttpRepository();
  }
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App repository={repository}/></React.StrictMode>);
}
void start();
