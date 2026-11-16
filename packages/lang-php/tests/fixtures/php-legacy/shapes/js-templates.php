<?php $items = array('a', 'b'); ?>
<script type="text/template" id="list"><% _.each(items, function(i) { %><li><%= i %></li><% }); %></script>
<script type="text/template" id="rows">
<% _.each(rows, function(r) { %>
<?php echo $label; ?>
<td><%= r.name %></td><% }); %>
</script>
<SCRIPT type="text/x-underscore-template" id="cells">
<?php echo $label; ?>
<% _.each(cells, function(c) { %><b><%= c %></b><% }); %>
</SCRIPT>
<script>var t = _.template('<%= name %>');</script>
<%= $title %>
<?php $tpl = '<% _.each(items) %>'; ?>
