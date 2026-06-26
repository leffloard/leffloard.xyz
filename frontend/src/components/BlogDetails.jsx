import { useParams, useNavigate, Link } from "react-router-dom";
import { blogPosts } from "../data/mock";
import { Calendar, Clock, ArrowLeft, Tag } from "lucide-react";

const BlogDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const post = blogPosts.find((p) => p.id === Number(id));

  if (!post) {
    return (
      <div className="text-center text-white py-32">
        <h1 className="text-3xl font-bold">Article not found</h1>
      </div>
    );
  }

  const formatContent = (content) => {
    if (!content) return "";
    
    return content
      .split('\n')
      .map((line, index) => {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('## ')) {
          return <h2 key={index} className="text-2xl font-bold text-white mt-8 mb-4 pt-6 border-t border-gray-800">{trimmed.replace('## ', '')}</h2>;
        }
        if (trimmed.startsWith('### ')) {
          return <h3 key={index} className="text-xl font-bold text-white mt-6 mb-3">{trimmed.replace('### ', '')}</h3>;
        }
        
        if (trimmed === '---') {
          return <hr key={index} className="my-8 border-gray-800" />;
        }
        
        if (trimmed.match(/^\d+\.\s/)) {
          const text = trimmed.replace(/^\d+\.\s/, '');
          return (
            <li key={index} className="ml-6 mb-2 text-gray-300">
              {formatInlineMarkdown(text)}
            </li>
          );
        }
        if (trimmed.startsWith('- ')) {
          const text = trimmed.replace(/^-\s/, '');
          return (
            <li key={index} className="ml-6 mb-2 text-gray-300 list-disc">
              {formatInlineMarkdown(text)}
            </li>
          );
        }
        
        if (trimmed === '') {
          return <br key={index} />;
        }
        
        return (
          <p key={index} className="text-gray-300 mb-4 leading-7">
            {formatInlineMarkdown(trimmed)}
          </p>
        );
      });
  };

  const formatInlineMarkdown = (text) => {
    if (!text) return text;
    
    let result = text;
    const replacements = [];
    
    const boldRegex = /\*\*(.*?)\*\*/g;
    const boldMatches = [];
    let match;
    while ((match = boldRegex.exec(text)) !== null) {
      boldMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        placeholder: `__BOLD_${boldMatches.length}__`
      });
    }
    
    const codeRegex = /`(.*?)`/g;
    const codeMatches = [];
    while ((match = codeRegex.exec(text)) !== null) {
      codeMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[1],
        placeholder: `__CODE_${codeMatches.length}__`
      });
    }
    
    const italicRegex = /\*(.*?)\*/g;
    const italicMatches = [];
    while ((match = italicRegex.exec(text)) !== null) {
      const isInsideBold = boldMatches.some(bold => 
        match.index >= bold.start && match.index < bold.end
      );
      const isDoubleAsterisk = text.substring(match.index - 1, match.index + match[0].length + 1).includes('**');
      
      if (!isInsideBold && !isDoubleAsterisk) {
        italicMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          content: match[1],
          placeholder: `__ITALIC_${italicMatches.length}__`
        });
      }
    }
    
    const allMatches = [
      ...boldMatches.map(m => ({ ...m, type: 'bold' })),
      ...codeMatches.map(m => ({ ...m, type: 'code' })),
      ...italicMatches.map(m => ({ ...m, type: 'italic' }))
    ].sort((a, b) => a.start - b.start);
    
    const filteredMatches = [];
    allMatches.forEach(match => {
      const overlaps = filteredMatches.some(existing => 
        (match.start < existing.end && match.end > existing.start)
      );
      if (!overlaps) {
        filteredMatches.push(match);
      }
    });
    
    let processedText = text;
    const placeholders = [];
    
    filteredMatches.sort((a, b) => b.start - a.start).forEach((match, idx) => {
      const before = processedText.substring(0, match.start);
      const after = processedText.substring(match.end);
      processedText = before + match.placeholder + after;
      
      placeholders.push({
        placeholder: match.placeholder,
        content: match.content,
        type: match.type,
        className: 
          match.type === 'bold' ? 'font-bold text-white' :
          match.type === 'code' ? 'bg-gray-900 text-cyan-400 px-2 py-1 rounded font-mono text-sm' :
          'italic'
      });
    });
    
    const parts = [];
    let currentIndex = 0;
    placeholders.forEach((ph, idx) => {
      const placeholderIndex = processedText.indexOf(ph.placeholder, currentIndex);
      if (placeholderIndex > currentIndex) {
        parts.push(processedText.substring(currentIndex, placeholderIndex));
      }
      parts.push(
        <span key={`${ph.type}-${idx}`} className={ph.className}>
          {ph.content}
        </span>
      );
      currentIndex = placeholderIndex + ph.placeholder.length;
    });
    
    if (currentIndex < processedText.length) {
      parts.push(processedText.substring(currentIndex));
    }
    
    return parts.length > 0 ? parts : text;
  };

  const contentLines = formatContent(post.content);

  return (
    <section className="py-20 bg-[#0a0a0a] min-h-screen">
      <div className="max-w-4xl mx-auto px-6">
        <Link
          to="/#blog"
          className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 transition-colors group"
        >
          <ArrowLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
          <span>Back to Blog</span>
        </Link>

        <div className="mb-8">
          <div className="flex flex-wrap gap-2 mb-6">
            {post.tags?.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-xs bg-gray-800 text-cyan-400 px-3 py-1.5 rounded-full border border-gray-700"
              >
                <Tag size={12} />
                {tag}
              </span>
            ))}
          </div>

          <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 leading-tight">
            {post.title}
          </h1>

          <div className="flex flex-wrap items-center gap-6 text-gray-400 text-sm mb-8 pb-6 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <Calendar size={18} className="text-cyan-400" />
              <span>{new Date(post.date).toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={18} className="text-cyan-400" />
              <span>{post.readTime}</span>
            </div>
          </div>
        </div>

        <div className="mb-10 rounded-2xl overflow-hidden border border-gray-800">
          <img
            src={post.image}
            alt={post.title}
            className="w-full h-auto object-cover"
          />
        </div>

        <article className="prose prose-invert max-w-none">
          <div className="text-lg text-gray-300 leading-relaxed">
            {contentLines}
          </div>
        </article>

        <div className="mt-16 pt-8 border-t border-gray-800">
          <div className="flex flex-wrap gap-2 mb-6">
            <span className="text-gray-500 text-sm">Tags:</span>
            {post.tags?.map((tag) => (
              <span
                key={tag}
                className="text-xs bg-gray-900 text-cyan-400 px-3 py-1 rounded-full border border-gray-800"
              >
                {tag}
              </span>
            ))}
          </div>
          
          <Link
            to="/#blog"
            className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 transition-colors group"
          >
            <ArrowLeft size={18} className="group-hover:-translate-x-1 transition-transform" />
            <span>Back to all articles</span>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default BlogDetails;
