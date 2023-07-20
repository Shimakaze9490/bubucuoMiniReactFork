import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react';

export default defineConfig({
  // plugins: react() ,
  test: {
    environment: 'jsdom',
    exclude: ['DebugReact/*'],
    // other options...
  },
})

// import { defineConfig } from 'vite';


// // https://vitejs.dev/config/
// export default defineConfig( {
  
//   test: {
//     globals: true,
//     environment: 'jsdom',
//     coverage: {
//       reporter: [ 'text', 'json', 'html' ]
//     }
//   }
// } );