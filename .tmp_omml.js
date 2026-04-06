let xml = '<m:eqArr><m:e>x+y=1</m:e><m:e>x^2-y=0</m:e></m:eqArr>';
xml = xml.replace(/<m:eqArr[^>]*>([\s\S]*?)<\/m:eqArr>/g, (match, inner) => {
    return "\\begin{matrix}" + inner.replace(/<\/m:e>\s*<m:e[^>]*>/g, "</m:e>\\\\<m:e>") + "\\end{matrix}";
});
xml = xml.replace(/<m:e(?:>| [^>]*>)/g, '{');
xml = xml.replace(/<\/m:e>/g, '}');
console.log(xml);
