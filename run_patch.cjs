const fs = require('fs');
const path = require('path');
const file = path.join('/Users/jainamshah/Desktop/vloop.app', 'packages/ai-agent/src/config/store.ts');
let code = fs.readFileSync(file, 'utf8');

if (!code.includes("import * as diff from 'diff'")) {
    code = "import * as fs from 'fs';\nimport * as path from 'path';\nimport * as diff from 'diff';\n" + code;
}

const headerMarker = '// ── Canvases ─';
const startIndex = code.indexOf(headerMarker);
if (startIndex === -1) {
    console.error("Marker not found in store.ts");
    process.exit(1);
}

// Find previous newline to include indentation
const lastNewline = code.lastIndexOf('\n', startIndex);
const keepCode = code.slice(0, lastNewline + 1);

const newCanvasPart = `    // ── Canvases ──────────────────────────────────────────────────────────

    private writeCanvasFiles(canvasId: CanvasId, files    private writeCanvasFilestring }[]) {
        if (!t        if (!t        if (
        const targetDir = path.join(this.canvasesPath, canvasId);
        fs.mkdirSync(targetDir, { recursive: true });
        
        for (const f of files) {
            const fullPath = path.join(targetDir, f.path);
            const dir = path.dirname(fullPath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, f.content, 'utf8');
        }
    }

    private readCanvasFiles(canvasId: CanvasId): { path: string; content: string }[] {
        if (!this.canvasesPa        if (!this.canvasesPa        if (!this.join(this.canvasesPath, canvasId);
        if (!fs.existsS        if (!fs.existsS        if (!fs.existsS st         if (!fs.existsS        if (!fs.existsS        if (!fs.existsS st         if (!fs.existsS        if (!fs.existsS        if (!fs.existsS st         if (!fs.existsS        if (!fs.existsS        if (!fs.existsS st                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath);
                } else if (entry.isFile()) {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    const relPath = path.relative(targetDir, fullPath);
                    files.push({ path: relPath, content });
                }
            }
        };
        
        scanDir(targetDir);
        return files;
    }

    private generateDiff(oldFiles: { path: string; content: string }[], newFiles: { path: string; content: string }[]): string {
        let diffText = '';
        
        for (const nf of newFiles) {
            const of = oldFiles.find(o => o.path === nf.path);
            if (of) {
                if (of.content !== nf.content) {
                    diffText += diff.createPatch(nf.path, of.content, nf.content) + '\n';
                }
            } else {
                diffText += diff.createPatch(nf.path, '', nf.content) + '\n';
            }
        }
        
        for (const of of oldFiles) {
            if (!newFiles.find(n => n.path === of.path)) {
                diffText += diff.createPatch(of.path, of.content, '') + '\n';
            }
        }
        
        return diffText;
    }

    createCanvas(input: CreateCanvasInput): CanvasConfig {
        const id = (input.id || generateId()) as CanvasId;
        const ts = now();
        
        if (input.files?.le        if (input.fith    riteCanvasFiles(id, input.files);
        }

        const initialContent = input.content ?? '';

        this.db.prepare(\`
            INSERT INTO canvases (id, name, description, content, metadata, owner, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        \`).run(id, input.name, input.description ?? '', initialContent, toJSON(input.metadata), input.owner, ts, ts);
        
        const oldFiles: {path:string, content:string}[] = [];
        const diffText = this.generateDiff(oldFiles, input.files ?? []);
        
        this.createCanvasCommit({
            canvasId: id,
                                                                                                                                              ,
             ha        input.owner             ha        in    message ?? 'Initial creation',
        });
        
        return this.getCanvas(id)!;
    }

    getCanvas(id: CanvasId): CanvasConfig | undefined {
        const row = this.db.prepare('SELECT * FROM canvases WHERE id = ?').get(id) as any;
        return row ? this.mapCanvas(row) : undefined;
    }

    listCanvases(owner?: string): CanvasConfig[] {
        const query = owner
            ? 'SELECT * FROM canvases WHERE owner = ? ORDER BY created_at DESC'
            : 'SELECT *            : 'SELECT *            : 'SELECT *            : 'SELECT *            : 'SELECT *            : 'SELECT *  re       er            : 'SELECT *            : 'S.map(r => this.mapCanvas(r));
    }

    updateCanvas(id: CanvasId, input: UpdateCanvasInput): C    updnf    updateCanvas(id: CanvasId, iis.getCanvas(id);
        if        if        if        if        if        if        if        if        if        if        if        if        if        if        if  s?        if        if        if        if        if        if        if        if        if ons        iftr = input.        if        if        if          is.db.prepare(\`
            UPDATE canvases SET name=?, de            UPDATE canvases SET name=?, de            UPDATE canvases SET name=?, de     input.name ?? existing.name,
            input.descripti    ? existing.description,
            contentStr,
                                a                                 a                                 a                                             a                                 a                                 a                                             a                                 a    diff: diffText,
            metadata: inpu            metadata: inpu            metadata: inpu            metadata: inpu            metadata: inpu                          metadata: inpu            metadata: inpu            metadata: inpu            metadata: inpu            metadata: inpu                          metadata: inpu            metadata: inpu            metadata: inpu            metadata: inpu            metadata: inpu                          metadata: inpu          ${commitId}\`);
        if (commit.canvasId !== id) throw new Error(\`Commit does not belong to canvas: \${id}\`);
        
        const existing = this.getCanvas(id);
        if (!existing) throw new Error(\`Canvas         if (!existing)          if (!existing) throw new Error(\`Canvas         if (!existing)          if (!existing) throw new Error(\`Canvas         if (!existing)          if (!existing) throw new Error(\`Canvas         if (!existing)          if (!existing) throw new Error(\`Canvas         if (!existing)          if (!existing) th
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    (                                                                                                 xi       (p)) fs.rmSync(p, { recursive: true, force: true });
        }
    }

    private mapCanvas(row: any): CanvasConfig {
        return {
            id: row.id as CanvasId,
            name: row.name,
            description: row.description,
            content: row.content,
            metadata: fromJSON(row.metadata),
            owner: row.owner,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               JSON(inpu        ta), input.changeType, input.changedBy, input.message, ts);
        return this.getCanvasCommit(id)!;
    }

    getCanvasCommit(id: CanvasCommitId): CanvasCommit | undefined {
        const row = this.db.prepare('SELECT * FROM canvas_commits WHERE id = ?').ge        const row = this.db. r        const row = this.db.prepare(efi        const row = this.db.prepare('vasId: CanvasId): CanvasCommit[] {
        const rows = (this.db.prepare('SELECT * FROM canvas_commits WHERE canvas_id = ? ORDER BY created_at DESC').all(canvasId)) as any[];
        return rows.map(r => this.mapCanvasCommit(r));
    }

    private mapCanvasCommit(row: any): CanvasCommit {
        return {
            id: row.id as CanvasCommitId,
            canvasId: row.canvas_id as CanvasId,
            content: row.content,
            diff: row.diff,
            metadata: fromJSON(row.metadata),
            changeType: row.change_type,
            changedBy: row.changed_by,
            message: row.message,
            createdAt: row.created_at,
        };
    }
}
`;

fs.writeFileSync(file, keepCode + newCanvasPart);
console.log("Replaced using exact absolute path.");
