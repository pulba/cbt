let latex2 = '<m:eqArr><m:e><m:f><m:num><m:t>1</m:t></m:num><m:den><m:t>2</m:t></m:den></m:f></m:e><m:e><m:rad><m:e><m:t>x</m:t></m:e></m:rad></m:e></m:eqArr>';
latex2 = latex2.replace(/<m:t(?:>| [^>]*>)([\s\S]*?)<\/m:t>/g, '$1');

let prev = '';
while (latex2 !== prev) {
    prev = latex2;
    
    latex2 = latex2.replace(/<m:f(?:>| [^>]*>)(?:(?!<\/?m:f\b).)*?<m:num(?:>| [^>]*>)((?:(?!<\/?m:f\b).)*?)<\/m:num>(?:(?!<\/?m:f\b).)*?<m:den(?:>| [^>]*>)((?:(?!<\/?m:f\b).)*?)<\/m:den>(?:(?!<\/?m:f\b).)*?<\/m:f>/s, '\\frac{$1}{$2}');
    latex2 = latex2.replace(/<m:rad(?:>| [^>]*>)(?:(?!<\/?m:rad\b).)*?<m:e(?:>| [^>]*>)((?:(?!<\/?m:rad\b).)*?)<\/m:e>(?:(?!<\/?m:rad\b).)*?<\/m:rad>/s, '\\sqrt{$1}');
    
    latex2 = latex2.replace(/<m:eqArr(?:>| [^>]*>)([\s\S]*?)<\/m:eqArr>/g, (match, inner) => {
        let rows = [];
        let r = inner.match(/<m:e(?:>| [^>]*>)([\s\S]*?)<\/m:e>/g);
        if (r) {
            r.forEach(row => {
                rows.push(row.replace(/<\/?m:e[^>]*>/g, '').trim());
            });
        }
        return '\\begin{matrix} ' + rows.join(' \\\\ ') + ' \\end{matrix}';
    });
}
console.log('NEW:', latex2);
