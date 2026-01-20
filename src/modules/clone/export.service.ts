import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import JSZip from 'jszip';
import * as crypto from 'crypto';
import * as cheerio from 'cheerio';

export interface ExportOptions {
  includeAssets: boolean;
  separateCSS: boolean;
  separateJS: boolean;
  minify: boolean;
  customCode?: {
    head?: string;
    bodyStart?: string;
    bodyEnd?: string;
  };
}

interface Asset {
  url: string;
  type: 'images' | 'videos' | 'fonts' | 'styles' | 'scripts';
  filename: string;
}

@Injectable()
export class ExportService {
  /**
   * Exporta página como arquivo ZIP completo
   */
  async exportAsZip(
    html: string,
    originalUrl: string,
    options: ExportOptions = {
      includeAssets: true,
      separateCSS: true,
      separateJS: true,
      minify: false
    }
  ): Promise<Buffer> {
    console.log('📦 [ExportService] Iniciando export como ZIP');
    console.log('📦 [ExportService] Opções:', options);

    const zip = new JSZip();
    let processedHtml = html;

    try {
      // 1. Extrair CSS
      let cssContent = '';
      if (options.separateCSS) {
        cssContent = this.extractCSS(html);
        
        // Remover CSS inline do HTML
        processedHtml = processedHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        
        // Adicionar link para CSS externo
        processedHtml = processedHtml.replace(
          '</head>',
          '<link rel="stylesheet" href="css/styles.css">\n</head>'
        );
        
        zip.file('css/styles.css', cssContent);
        console.log('📦 [ExportService] CSS extraído:', cssContent.length, 'bytes');
      }

      // 2. Extrair JavaScript
      let jsContent = '';
      if (options.separateJS) {
        jsContent = this.extractJS(html);
        
        if (jsContent) {
          // Remover scripts inline do HTML (mas manter os com src)
          processedHtml = processedHtml.replace(
            /<script(?![^>]*src=)[^>]*>[\s\S]*?<\/script>/gi,
            ''
          );
          
          // Adicionar script externo antes de </body>
          processedHtml = processedHtml.replace(
            '</body>',
            '<script src="js/scripts.js"></script>\n</body>'
          );
          
          zip.file('js/scripts.js', jsContent);
          console.log('📦 [ExportService] JS extraído:', jsContent.length, 'bytes');
        }
      }

      // 3. Adicionar código customizado
      if (options.customCode) {
        if (options.customCode.head) {
          processedHtml = processedHtml.replace(
            '</head>',
            `${options.customCode.head}\n</head>`
          );
        }
        if (options.customCode?.bodyStart) {
          processedHtml = processedHtml.replace(
            /<body([^>]*)>/i,
            (match, attrs) => `<body${attrs}>\n${options.customCode?.bodyStart}`
          );
        }
        if (options.customCode.bodyEnd) {
          processedHtml = processedHtml.replace(
            '</body>',
            `${options.customCode.bodyEnd}\n</body>`
          );
        }
      }

      // 4. Download de assets (se habilitado)
      const assetMap = new Map<string, string>();
      
      if (options.includeAssets) {
        const assets = this.extractAssets(processedHtml);
        console.log('📦 [ExportService] Assets encontrados:', assets.length);
        
        for (const asset of assets) {
          try {
            console.log('📥 Baixando asset:', asset.url.substring(0, 80));
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(asset.url, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            const localPath = `assets/${asset.type}/${asset.filename}`;
            zip.file(localPath, buffer);
            assetMap.set(asset.url, localPath);
            
            console.log('✅ Asset baixado:', localPath);
          } catch (error) {
            console.warn('⚠️ Falha ao baixar asset:', asset.url, error instanceof Error ? error.message : 'Erro desconhecido');
          }
        }
        
        // Substituir URLs no HTML
        for (const [originalUrl, localPath] of assetMap) {
          const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          processedHtml = processedHtml.replace(new RegExp(escapedUrl, 'g'), localPath);
        }
        
        console.log('📦 [ExportService] URLs substituídas:', assetMap.size);
      }

      // 5. Adicionar HTML processado
      zip.file('index.html', processedHtml);

      // 6. Adicionar arquivos auxiliares
      zip.file('README.md', this.generateReadme(originalUrl, options, assetMap.size));
      zip.file('.gitignore', this.generateGitignore());

      // 7. Gerar ZIP
      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
      });

      console.log('📦 [ExportService] ZIP gerado:', buffer.length, 'bytes');
      return buffer;

    } catch (error) {
      console.error('❌ [ExportService] Erro ao gerar ZIP:', error);
      throw new HttpException(
        `Erro ao gerar export: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Extrai CSS inline do HTML
   */
  private extractCSS(html: string): string {
    const cssBlocks: string[] = [];
    const $ = cheerio.load(html);

    // Extrair de tags <style>
    $('style').each((_, el) => {
      const css = $(el).html();
      if (css) {
        cssBlocks.push(css);
      }
    });

    // Extrair de links externos (se possível)
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('http')) {
        cssBlocks.push(`/* Stylesheet: ${href} */`);
      }
    });

    return cssBlocks.join('\n\n');
  }

  /**
   * Extrai JavaScript inline do HTML
   */
  private extractJS(html: string): string {
    const jsBlocks: string[] = [];
    const $ = cheerio.load(html);

    // Extrair apenas scripts inline (sem src)
    $('script').each((_, el) => {
      const src = $(el).attr('src');
      if (!src) {
        const js = $(el).html();
        if (js && js.trim()) {
          // Ignorar scripts do editor (cp-editor, tuglet, etc.)
          if (!js.includes('cp-editor') && !js.includes('tuglet')) {
            jsBlocks.push(js);
          }
        }
      }
    });

    return jsBlocks.join('\n\n');
  }

  /**
   * Extrai assets (imagens, vídeos, fontes) do HTML
   */
  private extractAssets(html: string): Asset[] {
    const assets: Asset[] = [];
    const seen = new Set<string>();
    const $ = cheerio.load(html);

    // 1. Imagens
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('http') && !seen.has(src)) {
        seen.add(src);
        const filename = this.generateFilename(src, 'img');
        assets.push({ url: src, type: 'images', filename });
      }
    });

    // 2. Backgrounds CSS (url(...))
    const bgRegex = /url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/gi;
    let match;
    while ((match = bgRegex.exec(html)) !== null) {
      const url = match[1];
      if (!seen.has(url)) {
        seen.add(url);
        const filename = this.generateFilename(url, 'bg');
        assets.push({ url, type: 'images', filename });
      }
    }

    // 3. Vídeos (source tags)
    $('video source').each((_, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('http') && !seen.has(src)) {
        seen.add(src);
        const filename = this.generateFilename(src, 'video');
        assets.push({ url: src, type: 'videos', filename });
      }
    });

    // 4. Fontes (@font-face)
    const fontRegex = /@font-face\s*\{[^}]*url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/gi;
    while ((match = fontRegex.exec(html)) !== null) {
      const url = match[1];
      if (!seen.has(url)) {
        seen.add(url);
        const filename = this.generateFilename(url, 'font');
        assets.push({ url, type: 'fonts', filename });
      }
    }

    console.log('📦 [ExportService] Assets extraídos:', {
      total: assets.length,
      images: assets.filter(a => a.type === 'images').length,
      videos: assets.filter(a => a.type === 'videos').length,
      fonts: assets.filter(a => a.type === 'fonts').length
    });

    return assets;
  }

  /**
   * Gera nome único para asset baseado em URL
   */
  private generateFilename(url: string, prefix: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const extMatch = pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|woff|woff2|ttf|otf|eot)$/i);
      const ext = extMatch ? extMatch[0] : '.jpg';
      
      // Gerar hash único
      const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
      
      return `${prefix}_${hash}${ext}`;
    } catch {
      return `${prefix}_${Date.now()}.jpg`;
    }
  }

  /**
   * Gera README.md para o projeto exportado
   */
  private generateReadme(originalUrl: string, options: ExportOptions, assetsCount: number): string {
    return `# Página Clonada

## 📁 Estrutura do Projeto

\`\`\`
.
├── index.html              # Página principal
${options.separateCSS ? '├── css/\n│   └── styles.css          # Estilos\n' : ''}${options.separateJS ? '├── js/\n│   └── scripts.js          # Scripts\n' : ''}${options.includeAssets ? `└── assets/
    ├── images/             # Imagens (${assetsCount} arquivos)
    ├── videos/             # Vídeos
    └── fonts/              # Fontes` : ''}
\`\`\`

## 🚀 Como Usar

### Opção 1: Abrir Localmente
1. Extraia o arquivo ZIP
2. Abra \`index.html\` no seu navegador

### Opção 2: Deploy em Servidor
1. Faça upload de todos os arquivos para seu servidor web
2. Mantenha a estrutura de pastas intacta
3. Acesse via seu domínio (ex: https://seusite.com)

## ⚙️ Configurações de Export

- **Assets incluídos**: ${options.includeAssets ? 'Sim' : 'Não'}
- **CSS separado**: ${options.separateCSS ? 'Sim' : 'Não'}
- **JavaScript separado**: ${options.separateJS ? 'Sim' : 'Não'}
- **Minificado**: ${options.minify ? 'Sim' : 'Não'}

## 📊 Informações

- **URL Original**: ${originalUrl}
- **Data de Export**: ${new Date().toLocaleString('pt-BR')}
- **Clonado com**: Clone Pages

## 📝 Notas

- Todos os tracking codes foram removidos durante o clone
- Links e funcionalidades foram preservados
- Imagens e assets foram baixados localmente

---

**Precisa de ajuda?** Visite https://clonepages.com/docs
`;
  }

  /**
   * Gera .gitignore
   */
  private generateGitignore(): string {
    return `.DS_Store
Thumbs.db
*.log
node_modules/
.env
.vscode/
.idea/
`;
  }
}
