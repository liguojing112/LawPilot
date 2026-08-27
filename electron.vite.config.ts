import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'out/renderer',
      modulePreload: false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html')
        }
      }
    },
    plugins: [
      react(),
      {
        name: 'fix-script-order',
        transformIndexHtml(html) {
          // Vite 构建后会在 <head> 中生成 <script type="module" crossorigin>
          // Electron file:// 协议下 type="module" + crossorigin 可能导致加载失败
          // 替换为 defer 确保 DOM 就绪后执行（避免 React Error #299）
          return html.replace(
            /<script\s+type="module"\s+crossorigin\s+(src="\.\/assets\/[^"]+"><\/script>)/g,
            '<script defer $1'
          )
        }
      }
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'shared')
      }
    },
    base: './',
  }
})
