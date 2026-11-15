import React from 'react';
import { createRoot } from 'react-dom/client';
import { TabletopApp } from './TabletopApp';
import { EntryGate } from './EntryGate';

createRoot(document.getElementById('tabletop-root')).render(
  <EntryGate>
    <TabletopApp />
  </EntryGate>,
);
